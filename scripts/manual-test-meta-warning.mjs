#!/usr/bin/env node
// Manual end-to-end test for the dropped-meta-key warning behavior.
//
// Usage:
//   1. Configure .env with credentials for a real WP install (Yoast SEO
//      active is the canonical case, but any install will do — the test
//      just needs a key that WP will silently drop).
//   2. From the repo root:  node scripts/manual-test-meta-warning.mjs
//
// What it does:
//   - Initializes the WP client via the same code path the MCP server uses.
//   - Creates a draft post.
//   - Calls update_content with three deliberately-unregistered meta keys
//     (`_yoast_wpseo_focuskw`, `_yoast_wpseo_metadesc`, `_yoast_wpseo_title`).
//   - Asserts the warning content block appears in the toolResult.
//   - Deletes the draft post (force) on cleanup.
//
// Exits 0 on success, non-zero on any assertion failure.

import 'dotenv/config';
import { initWordPress, makeWordPressRequest } from '../build/wordpress.js';
import { unifiedContentHandlers } from '../build/tools/unified-content.js';

const SCRATCH = {
  title: 'meta warning manual test (delete me)',
  status: 'draft',
  content: 'created by scripts/manual-test-meta-warning.mjs',
};

const SENT_META = {
  _yoast_wpseo_focuskw: 'manual-test',
  _yoast_wpseo_metadesc: 'manual test description',
  _yoast_wpseo_title: 'Manual Test Title',
};

let createdId = null;
let exitCode = 0;

function fail(msg) {
  console.error('FAIL:', msg);
  exitCode = 1;
}

function pass(msg) {
  console.log('PASS:', msg);
}

try {
  await initWordPress();

  const created = await makeWordPressRequest('POST', 'posts', SCRATCH);
  createdId = created.id;
  console.log(`Created scratch post id=${createdId}`);

  const result = await unifiedContentHandlers.update_content({
    content_type: 'post',
    id: createdId,
    meta: SENT_META,
  });

  const contentBlocks = result?.toolResult?.content;
  if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) {
    fail('toolResult.content was empty or not an array');
  } else {
    const warningBlock = contentBlocks.find(
      (b) => b && typeof b.text === 'string' && b.text.startsWith('Warning:'),
    );

    if (!warningBlock) {
      fail('expected a Warning: content block, none found');
      console.error('Got content blocks:', JSON.stringify(contentBlocks, null, 2));
    } else {
      pass('warning content block present');
      for (const key of Object.keys(SENT_META)) {
        if (!warningBlock.text.includes(key)) {
          fail(`warning text missing key: ${key}`);
        } else {
          pass(`warning mentions ${key}`);
        }
      }
    }
  }
} catch (err) {
  fail(`unhandled error: ${err.message}`);
  console.error(err);
} finally {
  if (createdId) {
    try {
      await makeWordPressRequest('DELETE', `posts/${createdId}`, { force: true });
      console.log(`Cleaned up scratch post id=${createdId}`);
    } catch (cleanupErr) {
      console.warn(`Cleanup failed for id=${createdId}: ${cleanupErr.message}`);
    }
  }
}

process.exit(exitCode);
