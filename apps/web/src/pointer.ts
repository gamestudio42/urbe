import { useEffect, useState } from 'react';

const COARSE_POINTER = '(pointer: coarse)';

/** True when the primary pointer is a finger (phones and most tablets). */
export function coarsePointer(): boolean {
  try {
    return window.matchMedia?.(COARSE_POINTER).matches ?? false;
  } catch {
    return false;
  }
}

/** Follows `(pointer: coarse)`, including a device toolbar that changes it at runtime. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(coarsePointer);
  useEffect(() => {
    const query = window.matchMedia(COARSE_POINTER);
    const onChange = () => setCoarse(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return coarse;
}
