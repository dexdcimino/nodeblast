export const BRAND = 'nodeblast';

const State = {
  user: null,
  profile: null,
  guest: false,
  theme: localStorage.getItem('nb-theme') || 'dark',
  palette: localStorage.getItem('nb-palette') || 'bold',
};
export default State;
