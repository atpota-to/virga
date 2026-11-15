// The account's chart notes as React state, and the marks a chart draws.
// Every chart on a page reads the same list, so a note added in the notes
// card shows on the chart above it at once: a change is announced on the
// window, and each reader takes the list again.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addAnnotation, followerMilestones, marksOnSeries, noteMark, readAnnotations, removeAnnotation, writeAnnotations } from './annotations.js';
import { cached } from './models.js';

const CHANGED = 'virga:annotations-changed';

export function useAnnotations(did) {
  const [list, setList] = useState(() => readAnnotations(did));
  useEffect(() => {
    setList(readAnnotations(did));
    const onChange = (e) => {
      if (e.detail === did) setList(readAnnotations(did));
    };
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, [did]);
  const save = useCallback(
    (next) => {
      writeAnnotations(did, next);
      window.dispatchEvent(new CustomEvent(CHANGED, { detail: did }));
    },
    [did],
  );
  const add = useCallback((day, label) => save(addAnnotation(readAnnotations(did), { day, label })), [did, save]);
  const remove = useCallback((id) => save(removeAnnotation(readAnnotations(did), id)), [did, save]);
  return { list, add, remove };
}

/**
 * The marks for one chart: the account's notes, and with `milestones` the
 * round numbers its follower count has passed, each placed on the bucket of
 * `series` (in `unit`) that holds its day.
 */
export function useChartMarks(archive, series, unit, { milestones = false } = {}) {
  const { list } = useAnnotations(archive.did);
  return useMemo(() => {
    const marks = list.map(noteMark);
    if (milestones) marks.push(...cached(archive, 'milestones', null, null, () => followerMilestones(archive.followers)));
    return marksOnSeries(series, unit, marks);
    // `archive.rev` moves when the followers do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, series, unit, milestones, archive.did, archive.rev]);
}
