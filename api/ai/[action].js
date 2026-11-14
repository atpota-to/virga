// Every /api/ai/* route, in one function.

import { createRouter } from '../../server/route.js';
import analyzePost from '../../server/ai/handlers/analyzePost.js';
import synthesizeStyle from '../../server/ai/handlers/synthesizeStyle.js';
import altText from '../../server/ai/handlers/altText.js';

export default createRouter(
  { 'analyze-post': analyzePost, 'synthesize-style': synthesizeStyle, 'alt-text': altText },
  { name: 'ai' },
);
