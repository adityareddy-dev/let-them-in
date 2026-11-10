// The people who try the shop. Each one gets only what their access need allows:
// what they can perceive and what they can do.

export type Mode = 'mouse' | 'keyboard' | 'screenreader' | 'zoom' | 'slowphone';

export interface Shopper {
  id: string;
  name: string;
  mode: Mode;
  about: string;
  maxSteps: number;
}

export const SHOPPERS: Shopper[] = [
  {
    id: 'tom',
    name: 'Tom',
    mode: 'mouse',
    about:
      'You have no disability. You use a laptop with a mouse and a normal screen. You are here as the baseline shopper.',
    maxSteps: 20,
  },
  {
    id: 'joel',
    name: 'Joel',
    mode: 'keyboard',
    about:
      'You have a hand tremor and cannot use a mouse or touchpad. You use only the keyboard: Tab and Shift+Tab to move, ' +
      'Enter and Space to press things, arrow keys inside lists. You can see the screen, so you rely on the focus ' +
      'outline to know where you are. If you cannot tell what is focused, you have to guess.',
    maxSteps: 30,
  },
  {
    id: 'maya',
    name: 'Maya',
    mode: 'screenreader',
    about:
      'You are blind and use a screen reader. You never see the screen. You only get what the screen reader reads ' +
      'out: the roles and names of things on the page. A button or field with no name is just "button" or ' +
      '"textbox" to you. You can move to any item the screen reader lists and activate it, or use the keyboard.',
    maxSteps: 30,
  },
  {
    id: 'ines',
    name: 'Ines',
    mode: 'zoom',
    about:
      'You have low vision. Your browser is zoomed to 200 percent so you can read. You use a mouse. You only see ' +
      'the part of the page that fits in the zoomed window, so you scroll a lot.',
    maxSteps: 20,
  },
  {
    id: 'kofi',
    name: 'Kofi',
    mode: 'slowphone',
    about:
      'You shop on a cheap, slow Android phone over a weak mobile connection. Pages take a long time and you tap ' +
      'with your thumb. You are patient for a few seconds, not forever.',
    maxSteps: 20,
  },
];

export function shopperById(id: string): Shopper {
  const s = SHOPPERS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown shopper ${id}`);
  return s;
}
