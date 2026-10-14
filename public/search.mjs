// Independent implementation. Discord's internal ranking is not reproduced.
export function parseQuery(query) {
  const filters = {}, terms = [];
  const tokens = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  for (const token of tokens) {
    const match = token.match(/^(from|in|mentions|has|before|after|on):(.+)$/i);
    if (!match) { terms.push(token.replace(/^"|"$/g, '').toLocaleLowerCase()); continue; }
    const key = match[1].toLowerCase(), value = match[2].replace(/^"|"$/g, '').toLocaleLowerCase();
    if (['before','after','on'].includes(key)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('Date invalide : utilisez AAAA-MM-JJ.');
    }
    (filters[key] ||= []).push(value.replace(/^[@#]/, ''));
  }
  return { terms, filters };
}
export function searchMessages(messages, query, { workspaceId, allowedChannelIds, sort = 'newest', offset = 0, limit = 10 } = {}) {
  if (!workspaceId || !Array.isArray(allowedChannelIds)) throw new Error('Le périmètre et les salons autorisés sont obligatoires.');
  if (!['newest','oldest','relevance'].includes(sort) || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Pagination ou tri invalide.');
  const { terms, filters } = parseQuery(query), allowed = new Set(allowedChannelIds);
  const normalize = value => String(value).toLocaleLowerCase();
  const matches = messages.filter(message => {
    if (message.workspaceId !== workspaceId || !allowed.has(message.channelId)) return false;
    const body = normalize(message.content), day = new Date(message.timestamp).toISOString().slice(0,10);
    if (!terms.every(term => body.includes(term))) return false;
    return Object.entries(filters).every(([key, values]) => values.every(value => {
      if (key === 'from') return [message.authorId, message.author].some(item => normalize(item) === value);
      if (key === 'in') return [message.channelId, message.channel].some(item => normalize(item) === value);
      if (key === 'mentions') return (message.mentions || []).some(item => normalize(item) === value);
      if (key === 'has') return (message.has || []).includes(value);
      if (key === 'before') return day < value;
      if (key === 'after') return day > value;
      if (key === 'on') return day === value;
      return false;
    }));
  }).map(message => ({ ...message, score: terms.reduce((score, term) => score + normalize(message.content).split(term).length - 1, 0) }));
  matches.sort((a,b) => (sort === 'relevance' ? b.score - a.score : 0) || (sort === 'oldest' ? 1 : -1) * (Date.parse(a.timestamp) - Date.parse(b.timestamp)) || a.id.localeCompare(b.id));
  return { total: matches.length, results: matches.slice(offset, offset + limit), hasMore: offset + limit < matches.length };
}
