import type { AnyTool } from '../server/tool.js';
import { connect } from './connect.js';
import { generateImage } from './generate-image.js';
import { generateVideo } from './generate-video.js';
import { inspect } from './inspect.js';
import { mediaDownload } from './media-download.js';
import { projectOpen } from './project-open.js';
import { screenshot } from './screenshot.js';
import { status } from './status.js';

export const tools: readonly AnyTool[] = [
  connect,
  status,
  screenshot,
  inspect,
  projectOpen,
  generateVideo,
  generateImage,
  mediaDownload,
];
