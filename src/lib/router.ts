import { useEffect, useState, useCallback } from 'react';

function getCleanPath(): { pathname: string; search: string; query: URLSearchParams } {
  // If the user accessed via a legacy hash link (e.g. /#/admin/tests), migrate cleanly to /admin/tests
  if (typeof window !== 'undefined' && window.location.hash && window.location.hash.startsWith('#/')) {
    const hashContent = window.location.hash.slice(1);
    const [pathPart, queryPart] = hashContent.split('?');
    const newPath = pathPart || '/';
    const newSearch = queryPart ? `?${queryPart}` : window.location.search;
    window.history.replaceState({}, '', newPath + newSearch);
    return { pathname: newPath, search: newSearch, query: new URLSearchParams(queryPart || window.location.search) };
  }

  const pathname = typeof window !== 'undefined' ? window.location.pathname || '/' : '/';
  const search = typeof window !== 'undefined' ? window.location.search || '' : '';
  const query = new URLSearchParams(search);
  return { pathname, search, query };
}

// Custom event to trigger immediate, lag-free route updates across all components
const NAV_EVENT = 'raterx_history_navigate';

export function navigate(to: string, options?: { replace?: boolean }) {
  if (typeof window === 'undefined') return;

  // Clean target: remove any '#' if mistakenly passed
  let cleanTo = to.startsWith('#') ? to.slice(1) : to;
  if (!cleanTo.startsWith('/')) {
    cleanTo = `/${cleanTo}`;
  }

  if (options?.replace) {
    window.history.replaceState({}, '', cleanTo);
  } else {
    window.history.pushState({}, '', cleanTo);
  }

  window.dispatchEvent(new Event(NAV_EVENT));
}

export function useRoute() {
  const [state, setState] = useState(getCleanPath);

  useEffect(() => {
    const onLocationChange = () => {
      setState(getCleanPath());
    };

    window.addEventListener('popstate', onLocationChange);
    window.addEventListener(NAV_EVENT, onLocationChange);
    window.addEventListener('hashchange', onLocationChange);

    return () => {
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener(NAV_EVENT, onLocationChange);
      window.removeEventListener('hashchange', onLocationChange);
    };
  }, []);

  const nav = useCallback((to: string, options?: { replace?: boolean }) => {
    navigate(to, options);
  }, []);

  return {
    route: state.pathname,
    pathname: state.pathname,
    search: state.search,
    query: state.query,
    navigate: nav,
  };
}

// Backwards-compatible alias for existing imports
export const useHashRoute = useRoute;

