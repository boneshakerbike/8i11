// Split stored advice_full into its data snapshot and conversation sections
export function parseAdviceFull(adviceFull: string): { dataSnapshot: string | null; conversation: string } {
  const hasSnapshot = adviceFull.startsWith('[Data for this session]');
  const convoMarker = '[Conversation]';
  const convoIdx = hasSnapshot ? adviceFull.indexOf(convoMarker) : -1;
  const dataSnapshot = hasSnapshot && convoIdx > 0
    ? adviceFull.slice('[Data for this session]\n'.length, convoIdx).trim()
    : null;
  const conversation = convoIdx > 0
    ? adviceFull.slice(convoIdx + convoMarker.length).trim()
    : adviceFull;
  return { dataSnapshot, conversation };
}
