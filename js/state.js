export const BRAND = 'nodeblast';

const State = {
  user: null,
  profile: null,
  theme: localStorage.getItem('nb-theme') || 'dark',
  palette: localStorage.getItem('nb-palette') || 'bold',
  accent: localStorage.getItem('nb-accent-color') || null,
};
export default State;
