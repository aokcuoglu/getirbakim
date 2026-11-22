// Applies the saved workspace theme before first paint on full loads of /yonetim; AdminTheme covers client navigation.
// The Report-Only CSP allows it by its sha256 (src/lib/csp.ts): any change here changes the hash, which is computed from this constant.
export const adminThemeScript=`try{if(location.pathname.startsWith("/yonetim"))document.documentElement.classList.toggle("dark",localStorage.getItem("gb-admin-theme")==="dark")}catch(e){}`;
