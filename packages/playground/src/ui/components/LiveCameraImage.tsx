import { type ImgHTMLAttributes, useCallback, useEffect, useRef } from 'react';

/** Removing an img from the DOM alone need not cancel a multipart request. */
export function LiveCameraImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const image = useRef<HTMLImageElement | null>(null);
  const release = useCallback(() => {
    if (image.current) image.current.src = 'data:,';
  }, []);
  const attach = useCallback(
    (node: HTMLImageElement | null) => {
      if (node !== image.current) release();
      image.current = node;
    },
    [release],
  );
  useEffect(() => {
    const hide = (event: PageTransitionEvent) => {
      if (!event.persisted) release();
    };
    window.addEventListener('pagehide', hide);
    return () => window.removeEventListener('pagehide', hide);
  }, [release]);
  return <img {...props} alt={props.alt} ref={attach} />;
}
