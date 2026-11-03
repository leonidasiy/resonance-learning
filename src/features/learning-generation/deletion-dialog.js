// @ts-check
/** Confirm deletion first, then offer independently retryable, optional feedback.
 * @param {{remove:()=>Promise<{ok:true,deletionId:string}|{ok:false}>,saveReason:(deletionId:string,reason:string)=>Promise<boolean>}} actions */
export function showKnowledgeDeletionDialog(actions) {
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'knowledge-deletion-dialog';
  dialog.setAttribute('aria-labelledby', 'knowledge-deletion-title');
  dialog.setAttribute('aria-describedby', 'knowledge-deletion-description');
  let busy = false;
  let deletionId = '';
  dialog.innerHTML = `<h2 id="knowledge-deletion-title">Delete this knowledge point?</h2><p id="knowledge-deletion-description">This will remove the knowledge card and its quizzes.</p><form><label class="deletion-reason" hidden>Reason for deleting (optional)<textarea name="reason" rows="3" placeholder="What would you like to avoid?"></textarea></label><p class="deletion-error" role="alert"></p><div class="deletion-actions"><button class="button" type="button" data-dismiss>Cancel</button><button class="button primary" type="submit">Delete</button></div></form>`;
  const form = /** @type {HTMLFormElement} */ (dialog.querySelector('form'));
  const submit = /** @type {HTMLButtonElement} */ (form.querySelector('[type=submit]'));
  const dismiss = /** @type {HTMLButtonElement} */ (form.querySelector('[data-dismiss]'));
  const reason = /** @type {HTMLTextAreaElement} */ (form.querySelector('textarea'));
  const error = /** @type {HTMLElement} */ (form.querySelector('[role=alert]'));
  const heading = /** @type {HTMLElement} */ (dialog.querySelector('h2'));
  const description = /** @type {HTMLElement} */ (dialog.querySelector('#knowledge-deletion-description'));
  dismiss.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); }, { once: true });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    if (deletionId && !reason.value.trim()) { dialog.close(); return; }
    busy = true; submit.disabled = dismiss.disabled = reason.disabled = true; error.textContent = '';
    submit.textContent = deletionId ? 'Saving…' : 'Deleting…';
    try {
      if (!deletionId) {
        const result = await actions.remove();
        if (!result.ok) { error.textContent = 'Could not delete this knowledge point. Please try again.'; return; }
        deletionId = result.deletionId;
        heading.textContent = 'Knowledge point deleted';
        description.textContent = 'Leave a brief reason to help ensure you don’t see similar knowledge points in the future. This is optional.';
        /** @type {HTMLElement} */ (form.querySelector('.deletion-reason')).hidden = false;
        dismiss.textContent = 'Skip';
      } else if (await actions.saveReason(deletionId, reason.value.trim())) {
        dialog.close();
      } else error.textContent = 'The knowledge point is deleted. Your reason could not be saved. Try again or skip.';
    } catch {
      error.textContent = deletionId ? 'The knowledge point is deleted. Your reason could not be saved. Try again or skip.' : 'Could not delete this knowledge point. Please try again.';
    } finally {
      busy = false; submit.disabled = dismiss.disabled = reason.disabled = false;
      submit.textContent = deletionId ? 'Save reason' : 'Delete';
      if (deletionId) reason.focus();
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  dismiss.focus();
}
