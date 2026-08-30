/**
 * Note: when using the Node.JS APIs this file does not apply — pass the same
 * options directly. All options: https://remotion.dev/docs/config
 */
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);

// The gradient is a WebGL2 fragment shader on every frame. Chrome's default
// headless renderer is SwiftShader — software rasterisation — which turns a
// sub-millisecond draw into most of a second, times a couple of thousand
// frames. "angle" routes through Metal on macOS and the GPU everywhere else.
Config.setChromiumOpenGlRenderer("angle");

// The whole video is flat fields, hairlines and large type: exactly the content
// H.264 bands on. The shader dithers, and this stops the encoder undoing it.
Config.setCodec("h264");
Config.setCrf(16);
Config.setPixelFormat("yuv420p");
