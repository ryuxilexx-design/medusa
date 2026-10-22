import { Config } from '@remotion/cli/config';
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// Remotion's downloaded headless shell never finishes loading the root on this Mac (macOS 27); the installed Chrome does.
Config.setBrowserExecutable('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
Config.setConcurrency(4);
