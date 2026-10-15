/** Tema do site: escolha salva no navegador; sem escolha, segue o sistema. */
export const THEME_KEY = 'vogochat-site-theme';

/** Aplica o tema antes do primeiro paint para não piscar claro→escuro. */
export const themeScript = `(function(){try{var m=localStorage.getItem('${THEME_KEY}');var d=m?m==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark')}catch(e){}})()`;

export function setTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  } catch {
    // navegação privada / armazenamento bloqueado: o tema vale só nesta visita
  }
}
