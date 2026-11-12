/**
 * Detail pages take their id from the query string, not the path. The site is exported as plain
 * static files (it can be hosted on GitHub Pages), which can't have a page per database row.
 */
export const leadHref = (id: number) => `/leads/detail?id=${id}`;
export const companyHref = (id: number) => `/companies/detail?id=${id}`;
