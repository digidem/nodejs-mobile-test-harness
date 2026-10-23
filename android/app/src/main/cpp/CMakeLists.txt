cmake_minimum_required(VERSION 3.18.1)
project(native-lib)

# libnode/include/node/ is populated at CI time from the nodejs-mobile release.
include_directories(${CMAKE_SOURCE_DIR}/../../../libnode/include/node/)

add_library(native-lib SHARED native-lib.cpp)

# Node 24's v8config.h requires C++20; NDK clang defaults to gnu++17.
set_target_properties(native-lib PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON)

# libnode.so is pre-built and placed under ../../../libnode/bin/<abi>/ at CI time.
add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES
    IMPORTED_LOCATION
    ${CMAKE_SOURCE_DIR}/../../../libnode/bin/${ANDROID_ABI}/libnode.so)

find_library(log-lib log)

target_link_libraries(native-lib libnode ${log-lib})
