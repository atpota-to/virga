/**
 * An account's post templates for React, over templateService.
 *
 *   const { templates, loading, error, ready, reload, create, update, remove } =
 *     useTemplates(did, { enabled })
 *
 * `did` is the account whose repo holds them: in the composer, the account it
 * writes as. `enabled: false` (or no DID) reads nothing and returns empty
 * results. Enabled, it shows the cached copy at once, loads once per account
 * (the service shares a load in flight, so a page of composers makes one
 * request) and re-renders whenever the service changes that account.
 *
 * `ready` is true once a load has confirmed the account's templates; `error`
 * is the last failed load, with `templates` still the cached copy.
 * `reload()` never rejects: its failure lands in `error`. `create`, `update`
 * and `remove` resolve with the service's result and rethrow, so the editor
 * can show the failure beside the form and keep what was typed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { templateService } from './templateService.js';

const EMPTY = Object.freeze([]);
const IDLE = Object.freeze({
  did: null,
  templates: EMPTY,
  loading: false,
  error: null,
  ready: false,
});
// Between an account change and the effect that primes for it.
const PENDING = Object.freeze({
  did: null,
  templates: EMPTY,
  loading: true,
  error: null,
  ready: false,
});

// The service's view of an account: its DID, and the session's agentFor,
// read at call time so a session that changed meanwhile is the one used.
function accountFrom(live, did) {
  return { did, agent: (d) => live.current.agentFor(d) };
}

function primed(service, did) {
  const ready = service.isLoaded(did);
  return {
    did,
    templates: service.primeFromCache(did),
    loading: !ready,
    error: null,
    ready,
  };
}

export function useTemplates(
  did,
  { enabled = true, service = templateService } = {},
) {
  const { agentFor } = useAtprotoSession();
  const forDid = enabled && did ? did : null;

  const [state, setState] = useState(() =>
    forDid ? primed(service, forDid) : IDLE,
  );

  // Read by the callbacks, so they keep one identity across renders and always
  // act for the account on screen.
  const liveRef = useRef({ did: forDid, agentFor, service });
  liveRef.current = { did: forDid, agentFor, service };

  const patch = useCallback((which, next) => {
    setState((s) => (s.did === which ? { ...s, ...next } : s));
  }, []);

  const load = useCallback(async () => {
    const { did: which, service: svc } = liveRef.current;
    if (!which) return EMPTY;
    patch(which, { loading: true });
    try {
      await svc.load(accountFrom(liveRef, which));
      patch(which, {
        templates: svc.list(which),
        loading: false,
        error: null,
        ready: svc.isLoaded(which),
      });
    } catch (error) {
      patch(which, { templates: svc.list(which), loading: false, error });
    }
    return liveRef.current.did === which ? svc.list(which) : EMPTY;
  }, [patch]);

  useEffect(() => {
    if (!forDid) return undefined;
    // A load that settled between the first render and this effect went
    // unheard, since nothing was subscribed yet.
    setState((s) =>
      s.did === forDid && s.ready === service.isLoaded(forDid)
        ? s
        : primed(service, forDid),
    );
    const unsubscribe = service.subscribe((changed) => {
      if (changed === forDid)
        patch(forDid, {
          templates: service.list(forDid),
          ready: service.isLoaded(forDid),
        });
    });
    if (!service.isLoaded(forDid)) load();
    return unsubscribe;
  }, [forDid, service, load, patch]);

  const create = useCallback(
    (template) =>
      liveRef.current.service.create(
        template,
        accountFrom(liveRef, liveRef.current.did),
      ),
    [],
  );
  const update = useCallback(
    (rkey, template) =>
      liveRef.current.service.update(
        rkey,
        template,
        accountFrom(liveRef, liveRef.current.did),
      ),
    [],
  );
  const remove = useCallback(
    (rkey) =>
      liveRef.current.service.remove(
        rkey,
        accountFrom(liveRef, liveRef.current.did),
      ),
    [],
  );

  const current = !forDid ? IDLE : state.did === forDid ? state : PENDING;

  return useMemo(
    () => ({
      templates: current.templates,
      loading: current.loading,
      error: current.error,
      ready: current.ready,
      reload: load,
      create,
      update,
      remove,
    }),
    [current, load, create, update, remove],
  );
}

export default useTemplates;
