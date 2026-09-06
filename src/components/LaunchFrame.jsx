// Rendered by the routers while they are still deciding what to show on
// the phone. Holds the launch veil (lib/launchVeil.jsx) up - the veil IS
// the picture - and paints nothing itself but the page colour, so that if
// the veil has already gone (a later navigation) there is no flash.
import React from 'react';
import { useLaunchHold } from '../lib/launchVeil.jsx';

export default function LaunchFrame() {
  useLaunchHold(true);
  return <div role="status" aria-label="Loading" style={{ position: 'fixed', inset: 0, background: 'var(--page, #0E100F)' }}/>;
}
