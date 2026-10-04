"use client";
export default function ErrorPage({ reset }: {reset:()=>void}) {
  return <main style={{padding:48,fontFamily:"system-ui"}}><h1>We couldn’t load this workspace.</h1><p>Please try again. Your saved properties remain in your account.</p><button onClick={reset}>Try again</button><p><a href="/">Return to LEXRENT</a></p></main>;
}
