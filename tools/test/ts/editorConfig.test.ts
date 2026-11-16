import { createBaseExtensions } from '../../../src/lib/editorConfig';

const eq = (a: unknown, b: unknown, m: string) => {
  if (a !== b) throw new Error(`FAIL ${m}: ${String(a)} != ${String(b)}`);
};

const ext = createBaseExtensions();
const starter = ext[0] as any;
eq(starter?.options?.link?.openOnClick, true, 'links in editable descriptions should open on click');

const collab = createBaseExtensions({ collaborative: true });
const collabStarter = collab[0] as any;
eq(collabStarter?.options?.link?.openOnClick, true, 'collaborative editor links should open on click');

console.log('editorConfig tests ok');
