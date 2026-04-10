const State = {
  user: null,
  profile: null,
  theme: localStorage.getItem('nb-theme') || 'dark',
};
export default State;
