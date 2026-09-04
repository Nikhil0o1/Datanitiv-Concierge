/** Resolve a DOM target and invoke the matching app handler (prototype fire()). */

export function fireAgentTarget(el, handlers) {
  if (!el || !handlers) return false;

  const act = el.getAttribute('data-act');
  if (act) {
    if (act === 'go-roster') handlers.mapRoster?.();
    else if (act === 'go-shrink') handlers.submitShrinkage?.();
    else if (act === 'go-accept') handlers.acceptRec?.();
    else if (act === 'sel-all') handlers.selectAllPackages?.();
    else if (act === 'sel-none') handlers.clearPackages?.();
    else if (act === 'exec') handlers.executeSelected?.();
    else if (act === 'open-create-plan') handlers.openCreatePlan?.(true);
    else if (act === 'submit-create-plan') handlers.submitCreatePlan?.();
    else if (act === 'open-detail') {
      const capId = el.closest?.('[data-cap]')?.getAttribute('data-cap') || el.getAttribute('data-cap');
      if (capId) handlers.openPlan?.(capId);
    }
    return true;
  }

  const tab = el.getAttribute('data-tab');
  if (tab) {
    handlers.openTab?.(tab);
    return true;
  }

  const view = el.getAttribute('data-view');
  if (view) {
    handlers.view?.(view);
    return true;
  }

  const filter = el.getAttribute('data-filter');
  if (filter) {
    handlers.setFilter?.(filter);
    return true;
  }

  const cap = el.getAttribute('data-cap');
  if (cap && (el.classList.contains('row') || el.classList.contains('land-row'))) {
    handlers.openPlan?.(cap);
    return true;
  }
  const land = el.closest?.('.land-row');
  if (land?.getAttribute('data-cap') && (el.classList.contains('open-mini') || el.classList.contains('land-row-main'))) {
    handlers.openPlan?.(land.getAttribute('data-cap'));
    return true;
  }

  const pkg = el.classList.contains('pkg') ? el : el.closest?.('.pkg');
  if (pkg) {
    const pkgCap = pkg.getAttribute('data-cap');
    if (pkgCap && !pkg.classList.contains('done') && !pkg.classList.contains('is-posted')) {
      handlers.togglePackage?.(pkgCap);
      return true;
    }
  }

  return false;
}

/** When cursor is off, run handler from a CSS selector without DOM animation. */
export function directFromSelector(selector, handlers) {
  if (selector.includes('data-filter="all"')) return handlers.setFilter?.('all');
  const filterMatch = selector.match(/data-filter="([^"]+)"/);
  if (filterMatch) return handlers.setFilter?.(filterMatch[1]);

  const capMatch = selector.match(/data-cap="([^"]+)"/);
  if (capMatch) {
    if (selector.includes('.row') || selector.includes('.land-row') || selector.includes('open-mini')) {
      return handlers.openPlan?.(capMatch[1]);
    }
    if (selector.includes('.pkg')) return handlers.togglePackage?.(capMatch[1]);
  }

  const tabMatch = selector.match(/data-tab="([^"]+)"/);
  if (tabMatch) return handlers.openTab?.(tabMatch[1]);

  if (selector.includes('data-view="queue"')) return handlers.view?.('queue');
  if (selector.includes('data-act="sel-all"')) return handlers.selectAllPackages?.();
  if (selector.includes('data-act="exec"')) return handlers.executeSelected?.();
  if (selector.includes('data-act="go-shrink"')) return handlers.submitShrinkage?.();
  if (selector.includes('data-act="go-roster"')) return handlers.mapRoster?.();
  if (selector.includes('data-act="go-accept"')) return handlers.acceptRec?.();
  if (selector.includes('data-act="open-create-plan"')) return handlers.openCreatePlan?.(true);
  if (selector.includes('data-act="submit-create-plan"')) return handlers.submitCreatePlan?.();
  return false;
}
