// @ts-check

/** Page capture uses the Mac; interactive navigation remains available while its reserved credit budget permits it.
 * @param {ReturnType<typeof import('./acquisition-client.js').createAcquisitionWorkflowBrowser>} acquisitionBrowser
 * @param {ReturnType<typeof import('./firecrawl-browser.js').createFirecrawlWorkflowBrowser>} interactiveBrowser
 * @param {boolean} interactiveAvailable
 */
export function routeWorkflowBrowser(acquisitionBrowser, interactiveBrowser, interactiveAvailable) {
  return interactiveAvailable
    ? Object.freeze({ ...acquisitionBrowser, inspect: interactiveBrowser.inspect, click: interactiveBrowser.click, screenshot: interactiveBrowser.screenshot, close: interactiveBrowser.close })
    : acquisitionBrowser;
}
