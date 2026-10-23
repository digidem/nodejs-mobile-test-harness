// Longer than the native pump's 2 KB read buffer, so it spans reads.
console.log('TAP version 13')
console.log('ok 1 - ' + 'x'.repeat(3000) + ' end')
console.log('1..1')
process.exit(0)
