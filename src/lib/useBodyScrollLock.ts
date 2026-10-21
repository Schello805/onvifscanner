"use client";

import { useEffect } from "react";

let activeLocks = 0;
let lockedScrollY = 0;
let previousBodyStyles: Partial<CSSStyleDeclaration> = {};
let previousHtmlStyles: Partial<CSSStyleDeclaration> = {};

function lockBodyScroll() {
  activeLocks += 1;
  if (activeLocks > 1) return;

  const body = document.body;
  const html = document.documentElement;
  lockedScrollY = window.scrollY;
  previousBodyStyles = {
    overflow: body.style.overflow !== "hidden" ? body.style.overflow : "",
    position: body.style.position !== "fixed" ? body.style.position : "",
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    paddingRight: body.style.paddingRight,
  };
  previousHtmlStyles = {
    overflow: html.style.overflow !== "hidden" ? html.style.overflow : "",
    overscrollBehavior: html.style.overscrollBehavior,
  };

  const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `calc(${window.getComputedStyle(body).paddingRight} + ${scrollbarWidth}px)`;
  }
  html.style.overflow = "hidden";
  html.style.overscrollBehavior = "none";
  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${lockedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
}

function unlockBodyScroll() {
  activeLocks = Math.max(0, activeLocks - 1);
  if (activeLocks > 0) return;

  const body = document.body;
  const html = document.documentElement;
  body.style.overflow = previousBodyStyles.overflow || "";
  body.style.position = previousBodyStyles.position || "";
  body.style.top = previousBodyStyles.top || "";
  body.style.left = previousBodyStyles.left || "";
  body.style.right = previousBodyStyles.right || "";
  body.style.width = previousBodyStyles.width || "";
  body.style.paddingRight = previousBodyStyles.paddingRight || "";

  html.style.overflow = previousHtmlStyles.overflow || "";
  html.style.overscrollBehavior = previousHtmlStyles.overscrollBehavior || "";

  // Guaranteed unfreeze
  if (body.style.overflow === "hidden") body.style.overflow = "";
  if (body.style.position === "fixed") body.style.position = "";
  if (html.style.overflow === "hidden") html.style.overflow = "";

  window.scrollTo(0, lockedScrollY);
}

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [locked]);
}
