#include "NodeRunner.h"
#include <NodeMobile/NodeMobile.h>
#include <string>

@implementation NodeRunner

// libuv requires all argv strings to live in one contiguous allocation.
+ (int) startEngineWithArguments:(NSArray*)arguments
{
    int c_arguments_size = 0;
    for (id argElement in arguments) {
        c_arguments_size += strlen([argElement UTF8String]);
        c_arguments_size++;
    }

    char* args_buffer = (char*)calloc(c_arguments_size, sizeof(char));
    char* argv[[arguments count]];
    char* current_args_position = args_buffer;
    int argument_count = 0;

    for (id argElement in arguments) {
        const char* current_argument = [argElement UTF8String];
        strncpy(current_args_position, current_argument, strlen(current_argument));
        argv[argument_count] = current_args_position;
        argument_count++;
        current_args_position += strlen(current_args_position) + 1;
    }

    int rc = node_start(argument_count, argv);
    free(args_buffer);
    return rc;
}
@end
