// Like tape: the plan and the exit code come from an exit listener.
console.log('TAP version 13')
console.log('not ok 1 - fails, reported from an exit listener')
process.on('exit', () => {
	console.log('1..1')
	process.exit(1)
})
