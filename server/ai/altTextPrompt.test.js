// The alt-text instruction: how a quick note or the image's kind changes the
// rules about text in the image. The note says what the author wants in words;
// these hold the rules to not contradicting it. A "describe" note against the
// verbatim-transcription rule is the one authors hit with screenshots of apps.

import { describe, it, expect } from 'vitest';
import {
  buildAltTextInstruction,
  ALT_TEXT_PRESETS,
  ALT_TEXT_KINDS,
} from './altTextPrompt.js';

const VERBATIM_RULE = 'if the image is primarily text';
const DESCRIBE_RULE = 'rather than transcribing its text';

describe('alt text: the long-standing rules', () => {
  it('transcribes a text-dominant image when nothing says otherwise', () => {
    const { instruction, textMode } = buildAltTextInstruction({});
    expect(textMode).toBe('auto');
    expect(instruction).toContain(VERBATIM_RULE);
    expect(instruction).not.toContain(DESCRIBE_RULE);
  });

  it('is unchanged for a revision note with no quick note', () => {
    const plain = buildAltTextInstruction({
      followUp: 'it is a luna moth',
      previousAltText: 'A leaf.',
    });
    expect(plain.isRefine).toBe(true);
    expect(plain.textMode).toBe('auto');
    expect(plain.instruction).toContain(VERBATIM_RULE);
  });
});

describe('alt text: quick notes', () => {
  const revise = (presets, extra = {}) =>
    buildAltTextInstruction({
      followUp: 'Describe what is shown instead of transcribing the text.',
      previousAltText: 'Settings. Account. Save changes.',
      presets,
      ...extra,
    });

  it('"describe" drops the verbatim rule instead of arguing with it', () => {
    const { instruction, textMode } = revise(['describe']);
    expect(textMode).toBe('describe');
    expect(instruction).toContain(DESCRIBE_RULE);
    expect(instruction).not.toContain(VERBATIM_RULE);
    expect(instruction).not.toContain(
      'do NOT summarize, paraphrase, or describe it',
    );
  });

  it('"transcribe" asks for every word, whatever the image looks like', () => {
    const { instruction, textMode } = revise(['transcribe']);
    expect(textMode).toBe('transcribe');
    expect(instruction).toContain('transcribe all legible text');
    expect(instruction).not.toContain(DESCRIBE_RULE);
  });

  it('length and wording notes leave the text rule alone', () => {
    for (const id of ['shorter', 'detail', 'plain']) {
      expect(revise([id]).textMode).toBe('auto');
    }
  });

  it('ignores ids it does not know, and anything that is not a list', () => {
    expect(revise(['summon-moths']).textMode).toBe('auto');
    expect(revise('describe').textMode).toBe('auto');
    expect(revise([{ id: 'describe' }]).textMode).toBe('auto');
  });

  it('keeps the note itself in the instruction', () => {
    expect(revise(['describe']).instruction).toContain(
      'Describe what is shown instead of transcribing the text.',
    );
  });

  it('lists the ids the composer sends', () => {
    expect(ALT_TEXT_PRESETS).toEqual([
      'describe',
      'transcribe',
      'shorter',
      'detail',
      'plain',
    ]);
  });
});

describe('alt text: the kind of image', () => {
  it('describes a screenshot of an app or website from the first pass', () => {
    const { instruction, textMode, isRefine } = buildAltTextInstruction({
      kind: 'interface',
    });
    expect(isRefine).toBe(false);
    expect(textMode).toBe('describe');
    expect(instruction).toContain('screenshot of an app or website');
    expect(instruction).not.toContain(VERBATIM_RULE);
  });

  it('reads a chart for its trend rather than its labels', () => {
    const { instruction, textMode } = buildAltTextInstruction({
      kind: 'chart',
    });
    expect(textMode).toBe('chart');
    expect(instruction).toContain('main trend or takeaway');
  });

  it('transcribes an image the author says is mostly text', () => {
    expect(buildAltTextInstruction({ kind: 'text' }).textMode).toBe(
      'transcribe',
    );
  });

  it('names a photograph without changing the text rule', () => {
    const { instruction, textMode } = buildAltTextInstruction({
      kind: 'photo',
    });
    expect(textMode).toBe('auto');
    expect(instruction).toContain('The author says this is a photograph.');
  });

  it('lets a quick note outrank the kind chosen before the first description', () => {
    expect(
      buildAltTextInstruction({
        kind: 'interface',
        followUp: 'read it out',
        presets: ['transcribe'],
      }).textMode,
    ).toBe('transcribe');
    expect(
      buildAltTextInstruction({
        kind: 'text',
        followUp: 'describe it',
        presets: ['describe'],
      }).textMode,
    ).toBe('describe');
  });

  it('ignores a kind it does not know', () => {
    const { instruction, textMode } = buildAltTextInstruction({
      kind: 'unset',
    });
    expect(textMode).toBe('auto');
    expect(instruction).not.toContain('The author says');
  });

  it('lists the kinds the composer offers', () => {
    expect(ALT_TEXT_KINDS).toEqual(['photo', 'interface', 'chart', 'text']);
  });
});

describe('alt text: people in the image', () => {
  const PEOPLE_RULE = 'describe them only by what can be seen';
  const NO_GUESSING =
    "do NOT state or guess anyone's gender, pronouns, race, ethnicity or skin color";
  const AUTHOR_SAYS =
    "only when the post context or the author's note gives it";
  const REVISION_LINE = 'Where the previous alt text says or guesses';

  const everyShape = () => {
    const shapes = [{}, { context: 'Fall walk' }];
    for (const kind of ALT_TEXT_KINDS) shapes.push({ kind });
    for (const id of ALT_TEXT_PRESETS) {
      shapes.push({
        followUp: 'Make it shorter.',
        previousAltText: 'A person on a porch.',
        presets: [id],
      });
    }
    shapes.push({ followUp: "It's a luna moth" });
    return shapes;
  };

  it('holds every description and every revision to it, whatever the kind or note', () => {
    for (const opts of everyShape()) {
      const { instruction } = buildAltTextInstruction(opts);
      expect(instruction).toContain(PEOPLE_RULE);
      expect(instruction).toContain(NO_GUESSING);
      expect(instruction).toContain('use "they" and "their"');
    }
  });

  it('leaves who someone is to the author', () => {
    expect(
      buildAltTextInstruction({ context: 'me and my sister at the lake' })
        .instruction,
    ).toContain(AUTHOR_SAYS);
  });

  it('keeps text in the image as written', () => {
    const { instruction } = buildAltTextInstruction({ kind: 'text' });
    expect(instruction).toContain(
      'not about text in the image, which is transcribed as written',
    );
    expect(instruction).toContain('transcribe all legible text');
  });

  it('asks a revision to replace guesses the previous alt text already made', () => {
    const { instruction } = buildAltTextInstruction({
      followUp: 'Make it shorter.',
      previousAltText:
        'A smiling man with messy dark hair takes a selfie. He wears a green jacket.',
      presets: ['shorter'],
    });
    expect(instruction).toContain(REVISION_LINE);
    expect(instruction.indexOf(REVISION_LINE)).toBeGreaterThan(
      instruction.indexOf('Previous alt text'),
    );
  });

  it('has no previous guesses to replace without previous alt text', () => {
    expect(buildAltTextInstruction({}).instruction).not.toContain(
      REVISION_LINE,
    );
    expect(
      buildAltTextInstruction({ followUp: "It's a luna moth" }).instruction,
    ).not.toContain(REVISION_LINE);
  });
});

describe('alt text: the length rule', () => {
  it('only mentions transcribing to the limit when text is being transcribed', () => {
    expect(buildAltTextInstruction({}).instruction).toContain(
      'transcribe verbatim from the beginning',
    );
    expect(buildAltTextInstruction({ kind: 'text' }).instruction).toContain(
      'transcribe verbatim from the beginning',
    );
    expect(
      buildAltTextInstruction({ kind: 'interface' }).instruction,
    ).not.toContain('transcribe verbatim from the beginning');
    expect(
      buildAltTextInstruction({ kind: 'chart' }).instruction,
    ).not.toContain('transcribe verbatim from the beginning');
  });
});
