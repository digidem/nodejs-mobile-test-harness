#include <jni.h>
#include <string>
#include <cstdlib>
#include <cstring>
#include <pthread.h>
#include <unistd.h>
#include <android/log.h>
#include "node.h"

// Redirect node's stdout/stderr to logcat so TAP output shows up under
// `adb logcat -s NODEJS-MOBILE:I`.
static const char *LOGTAG = "NODEJS-MOBILE";
static int pipe_stdout[2];
static int pipe_stderr[2];
static pthread_t thread_stdout;
static pthread_t thread_stderr;

static void *pump(int fd, android_LogPriority prio) {
    char buf[2048];
    ssize_t n;
    while ((n = read(fd, buf, sizeof(buf) - 1)) > 0) {
        // Split on newlines so each line becomes its own logcat entry,
        // otherwise TAP output gets jumbled inside a single log line.
        buf[n] = '\0';
        char *start = buf;
        for (char *p = buf; p < buf + n; p++) {
            if (*p == '\n') {
                *p = '\0';
                __android_log_write(prio, LOGTAG, start);
                start = p + 1;
            }
        }
        if (start < buf + n) {
            __android_log_write(prio, LOGTAG, start);
        }
    }
    return NULL;
}

static void *thread_stdout_func(void *) { return pump(pipe_stdout[0], ANDROID_LOG_INFO); }
static void *thread_stderr_func(void *) { return pump(pipe_stderr[0], ANDROID_LOG_ERROR); }

static int start_redirecting_stdout_stderr() {
    setvbuf(stdout, 0, _IONBF, 0);
    if (pipe(pipe_stdout) != 0) return -1;
    dup2(pipe_stdout[1], STDOUT_FILENO);

    setvbuf(stderr, 0, _IONBF, 0);
    if (pipe(pipe_stderr) != 0) return -1;
    dup2(pipe_stderr[1], STDERR_FILENO);

    // Left joinable so drain_stdio_pumps() can wait for them.
    if (pthread_create(&thread_stdout, 0, thread_stdout_func, 0) != 0) return -1;
    if (pthread_create(&thread_stderr, 0, thread_stderr_func, 0) != 0) return -1;
    return 0;
}

// Without this, System.exit() on the Java side races the pumps and the final
// stderr — usually the uncaught-exception traceback — never reaches logcat.
static void drain_stdio_pumps() {
    // dup2() left two descriptors on each pipe's write end; read() only EOFs
    // once both are closed.
    close(STDOUT_FILENO);
    close(pipe_stdout[1]);
    close(STDERR_FILENO);
    close(pipe_stderr[1]);
    pthread_join(thread_stdout, NULL);
    pthread_join(thread_stderr, NULL);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_digidem_nodejstest_TestActivity_startNodeWithArguments(
        JNIEnv *env,
        jobject /* this */,
        jobjectArray arguments) {

    jsize argc = env->GetArrayLength(arguments);

    // libuv requires all argv strings to live in one contiguous allocation.
    int total = 0;
    for (int i = 0; i < argc; i++) {
        total += strlen(env->GetStringUTFChars(
            (jstring)env->GetObjectArrayElement(arguments, i), 0));
        total++;
    }
    char *args_buffer = (char *)calloc(total, sizeof(char));
    char *argv[argc];
    char *cursor = args_buffer;
    for (int i = 0; i < argc; i++) {
        const char *s = env->GetStringUTFChars(
            (jstring)env->GetObjectArrayElement(arguments, i), 0);
        strncpy(cursor, s, strlen(s));
        argv[i] = cursor;
        cursor += strlen(cursor) + 1;
    }

    if (start_redirecting_stdout_stderr() == -1) {
        __android_log_write(ANDROID_LOG_ERROR, LOGTAG,
            "Couldn't redirect stdout/stderr to logcat.");
    }

    int rc = node::Start(argc, argv);
    free(args_buffer);
    drain_stdio_pumps();
    return (jint)rc;
}

extern "C" JNIEXPORT void JNICALL
Java_com_digidem_nodejstest_TestActivity_logExitSentinel(
        JNIEnv *env,
        jobject /* this */,
        jint code) {
    // The CI workflow greps for this line to extract the Node exit code.
    __android_log_print(ANDROID_LOG_INFO, LOGTAG, "__NODE_EXIT__:%d", (int)code);
}
