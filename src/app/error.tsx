"use client";
import StoreError from "./(store)/error";

// Catches errors thrown by the store or workspace layouts themselves, which render outside (store)/error.tsx;
// it supplies the <main id="main-content"> those layouts would have provided.
export default function ErrorPage({ retry }: { retry: () => void }) {
  return <main id="main-content" tabIndex={-1}><StoreError retry={retry}/></main>;
}
