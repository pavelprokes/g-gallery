"use client";

// The wedding page (the QR code's entry, and every gallery opened through it)
// fails the same way the gallery does — and should look the same when it does,
// not fall through to Next's unbranded "Application error". One screen, shared.
export { default } from "@/app/g/[token]/error";
