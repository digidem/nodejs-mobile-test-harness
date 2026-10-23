import { createErrorClassesByName } from 'custom-error-creator'

export const {
	InvalidVersion,
	DownloadFailed,
	InvalidRuntimeDir,
	InvalidProject,
	BuildFailed,
	AppNotBuilt,
	DeviceNotFound,
	DeviceTimeout,
	CommandFailed,
	LaunchFailed,
	AppCrashed,
	MissingSentinel,
	Timeout,
} = createErrorClassesByName([
	{
		code: 'INVALID_VERSION',
		message:
			'{version} is not a digidem/nodejs-mobile release (expected X.Y.Z-R); the v18 line is not supported',
	},
	{ code: 'DOWNLOAD_FAILED', message: 'Download of {url} failed: {reason}' },
	{
		code: 'INVALID_RUNTIME_DIR',
		message:
			'{dir} is not an unpacked nodejs-mobile {platform} release (missing {missing})',
	},
	{ code: 'INVALID_PROJECT', message: 'Invalid project: {reason}' },
	{
		code: 'BUILD_FAILED',
		message: 'Build failed: {command} exited with {exitCode}',
	},
	{
		code: 'APP_NOT_BUILT',
		message: 'No built app at {path}; build first (drop --run-only)',
	},
	{ code: 'DEVICE_NOT_FOUND', message: 'No device: {reason}' },
	{
		code: 'DEVICE_TIMEOUT',
		message: 'Device timed out: {step} did not finish within {seconds}s',
	},
	{ code: 'COMMAND_FAILED', message: '{command} failed: {output}' },
	{ code: 'LAUNCH_FAILED', message: 'Launch failed: {reason}' },
	{
		code: 'APP_CRASHED',
		message:
			'App crashed: the app process died without printing the exit sentinel',
	},
	{
		code: 'MISSING_SENTINEL',
		message: 'Missing sentinel: {reason}',
	},
	{
		code: 'TIMEOUT',
		message: 'Timed out after {seconds}s waiting for the exit sentinel',
	},
])
