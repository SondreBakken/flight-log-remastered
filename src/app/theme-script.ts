// Runs synchronously in <head> before first paint. The root layout cannot read the cookie
// server-side (cookies() would make every page dynamic under Cache Components), so the
// script sets data-theme on <html> client-side; the layout carries suppressHydrationWarning.
// Only the exact value "dark" opts in; anything else stays light.
export const THEME_SCRIPT = `(function(){try{var m=document.cookie.split('; ').some(function(c){return c==='theme=dark'});if(m)document.documentElement.dataset.theme='dark'}catch(e){}})()`
