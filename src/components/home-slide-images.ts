import {createContext, useContext} from "react";

/**
 * Whether the surrounding home carousel slide renders its images. Slides past the first page keep their links in the
 * HTML but drop the `<img>` until the carousel is armed (#1289). The default keeps standalone renders unchanged.
 */
export const SlideImages = createContext(true);
export const useSlideImages = () => useContext(SlideImages);
