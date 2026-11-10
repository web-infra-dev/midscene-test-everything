import { useEffect, useState } from 'react';

export type Route =
  | 'connect'
  | 'workspace'
  | `workspace/${string}`
  | `connect/${string}`;
export function readRoute(): Route {
  const path = location.hash.slice(2);
  if (/^(connect|workspace)\/[a-f0-9-]{36}$/.test(path)) return path as Route;
  return ['connect', 'workspace'].includes(path) ? (path as Route) : 'connect';
}
export function navigate(route: Route, replace = false) {
  if (readRoute() === route && location.hash === `#/${route}`) return;
  if (replace) {
    history.replaceState(null, '', `#/${route}`);
    window.dispatchEvent(new Event('hashchange'));
  } else location.hash = `/${route}`;
}
export function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const changed = () => setRoute(readRoute());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  return route;
}
