import { useEffect, useState, useCallback } from 'react';

export function useHashRoute() {
  const parseHash = () => {
    const raw = window.location.hash.slice(1) || '/';
    const [pathPart, queryPart] = raw.split('?');
    const pathname = pathPart || '/';
    const params = new URLSearchParams(queryPart || '');
    return { route: pathname, rawRoute: raw, pathname, query: params };
  };

  const [state, setState] = useState(parseHash);

  useEffect(() => {
    const onHash = () => setState(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((to: string) => {
    window.location.hash = to;
  }, []);

  return {
    route: state.pathname,
    rawRoute: state.rawRoute,
    pathname: state.pathname,
    query: state.query,
    navigate,
  };
}

export function navigate(to: string) {
  window.location.hash = to;
}
