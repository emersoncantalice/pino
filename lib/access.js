/**
 * Papel de um usuário em um quadro:
 *   owner  — dono (pode tudo, inclusive compartilhar e excluir)
 *   editor — pode editar
 *   viewer — só visualiza
 *   null   — sem acesso
 */
export function roleFor(board, userId) {
  if (!board || !userId) return null;
  if (board.ownerId === userId) return 'owner';
  const member = board.members && board.members[userId];
  if (member === 'editor' || member === 'viewer') {
    // Um convite explícito nunca dá menos acesso do que o link.
    if (member === 'viewer' && board.shareMode === 'edit') return 'editor';
    return member;
  }
  if (board.shareMode === 'edit') return 'editor';
  if (board.shareMode === 'view') return 'viewer';
  return null;
}

export function canEdit(role) {
  return role === 'owner' || role === 'editor';
}
