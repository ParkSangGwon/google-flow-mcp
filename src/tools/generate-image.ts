import { z } from 'zod';
import { generateMedia } from '../flow/composer.js';
import { IMAGE_MODEL_IDS } from '../flow/labels.js';
import { defineTool } from '../server/tool.js';
import { generateOutput } from './generate-video.js';

export const generateImage = defineTool({
  name: 'flow_generate_image',
  title: 'Generate an image',
  description:
    'Generate images through the Flow agent composer (Nano Banana models) and download them. Spends Flow credits when auto_confirm=true; ' +
    'auto_confirm=false prepares and verifies without sending. resume=true only waits for / downloads an in-flight generation.',
  input: {
    prompt: z.string().min(1),
    model: z.enum(IMAGE_MODEL_IDS).default('nano-banana-pro'),
    ratio: z.enum(['9:16', '16:9', '1:1', '4:3', '3:4']).default('1:1'),
    count: z.number().int().min(1).max(4).default(1).describe('Number of images to request'),
    reference_images: z.array(z.string()).default([]).describe('Local image paths attached as visual references'),
    project_url: z.url(),
    output_dir: z.string(),
    auto_confirm: z.boolean().default(false),
    resume: z.boolean().default(false),
    job_id: z.string().optional(),
  },
  output: generateOutput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async run(ctx, args) {
    return generateMedia(ctx, {
      kind: 'image',
      prompt: args.prompt,
      model: args.model,
      ratio: args.ratio,
      duration: undefined,
      count: args.count,
      referenceImages: args.reference_images,
      projectUrl: args.project_url,
      outputDir: args.output_dir,
      autoConfirm: args.auto_confirm,
      resume: args.resume,
      jobId: args.job_id,
      editMode: false,
    });
  },
});
