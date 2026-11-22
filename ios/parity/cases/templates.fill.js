// src/posting/templates/postTemplates.js: fillTemplate and
// templatePreviewParts, the text a template posts and the preview of it,
// over every template in _templates.js with contexts and answers of every
// kind, and the spacing and gap cases of postTemplates.test.js (an empty
// blank's gap closed beside spaces, line ends and punctuation, and nowhere
// else). Swift: VirgaPosting/Templates/PostTemplates.swift.

import * as PT from '../../../src/posting/templates/postTemplates.js';
import { each } from './_helpers.js';
import {
  ANSWERS,
  CONTEXTS,
  TEMPLATES,
  ada,
  contextFor,
  optional,
} from './_templates.js';

export const sources = ['src/posting/templates/postTemplates.js'];

// Each template is filled with these pairs of context and answers.
const PAIRS = [
  ['ada', 'idea'],
  ['ada', 'ideaTiming'],
  ['ada', 'prototype'],
  ['ada', 'string'],
  ['ada', 'nested'],
  ['juniper', 'none'],
  ['juniper', 'padded'],
  ['none', 'everything'],
  ['none', 'nulls'],
  ['none', 'array'],
  ['null', 'empty'],
  ['emptyStrings', 'context'],
  ['noSelf', 'numbers'],
  ['dottedHandle', 'unicode'],
];

const SPACING = [
  'Glad you like it :) see you ;)',
  'Bonjour {{their.firstName}} ! Ça va ?',
  'Well ... maybe',
  'Code:\n    indented  twice \nnext',
  '  Hi {{their.firstName}}.\n',
];

const GAPS = [
  'one {{a}} two',
  'one  {{a}} two',
  'one {{a}}{{b}} two',
  'one {{a}} {{b}} two',
  'on our list. {{a}}',
  'first {{a}}\nsecond',
  '{{a}} starts here',
  'Code:\n    {{a}}indented',
  'Code:\n    {{a}} indented',
  'the idea of {{a}}, and',
  'Bonjour {{a}} !',
  'Hi {{a}} :) there',
  '{{a}} {{b}} {{c}}',
  '  {{a}}  \n  {{b}}  ',
  'x {{a}}\t{{b}}\ty',
  'x\t{{a}} y',
  '{{a}}.',
  'a {{a}}? b',
  'a {{a}}\r\nb',
  'a\n{{a}} b',
  'a {{a}} \n b',
  '🌿 {{a}} 🌿',
  'a {{a}}\u00A0b',
  'a\u00A0{{a}} b',
  '{{a}}\n{{b}}\n{{c}}',
  'a {{a}} {{x}} {{b}} b',
  'end with space {{a}} ',
  '\n\n{{a}}\n\n',
];

export default async function cases() {
  const inputs = [];
  for (const [tname, template] of Object.entries(TEMPLATES))
    for (const [cname, aname] of PAIRS)
      inputs.push({
        $id: `${tname}-${cname}-${aname}`,
        template,
        answers: ANSWERS[aname],
        context: CONTEXTS[cname],
      });
  const ctx = CONTEXTS.ada;
  for (const text of SPACING)
    inputs.push({
      $id: `spacing-${text}`,
      template: { text },
      answers: {},
      context: ctx,
    });
  for (const text of GAPS) {
    inputs.push({
      $id: `gap-${text}`,
      template: optional(text),
      answers: {},
      context: ctx,
    });
    inputs.push({
      $id: `gap-answered-${text}`,
      template: optional(text),
      answers: { a: 'A', c: ' ' },
      context: ctx,
    });
  }
  inputs.push(
    {
      $id: 'context-before',
      template: { text: "I'm {{my.handle}}" },
      answers: ANSWERS.context,
      context: contextFor(ada, { me: {} }),
    },
    {
      $id: 'context-after',
      template: { text: "I'm {{my.handle}}" },
      answers: ANSWERS.context,
      context: ctx,
    },
    { $id: 'null-template', template: null, answers: {}, context: ctx },
  );
  return [
    ...(await each('fillTemplate', inputs, ({ template, answers, context }) =>
      PT.fillTemplate(template, answers, context),
    )),
    ...(await each(
      'templatePreviewParts',
      inputs,
      ({ template, answers, context }) =>
        PT.templatePreviewParts(template, answers, context),
    )),
  ];
}
