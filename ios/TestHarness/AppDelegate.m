#import "AppDelegate.h"
#import "NodeRunner.h"
#include <stdio.h>
#include <stdlib.h>

@interface AppDelegate ()
@end

@implementation AppDelegate

- (void)startNode {
    NSString* srcPath = [[NSBundle mainBundle] pathForResource:@"nodejs-project/main.js" ofType:@""];
    NSArray* nodeArguments = @[ @"node", srcPath ];
    int rc = [NodeRunner startEngineWithArguments:nodeArguments];
    // Emit the exit sentinel for the CI workflow to grep.
    // `simctl launch --console-pty` streams the app's stdout to the runner.
    fprintf(stdout, "__NODE_EXIT__:%d\n", rc);
    fflush(stdout);
    // Terminate the simulator app so simctl's --console-pty attach returns.
    exit(rc);
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
    // Force stdout/stderr line-buffered so prints land in the pty promptly.
    setvbuf(stdout, NULL, _IOLBF, 0);
    setvbuf(stderr, NULL, _IOLBF, 0);

    NSThread* nodejsThread = [[NSThread alloc]
        initWithTarget:self
        selector:@selector(startNode)
        object:nil];
    [nodejsThread setStackSize:2 * 1024 * 1024];
    [nodejsThread start];
    return YES;
}

@end
