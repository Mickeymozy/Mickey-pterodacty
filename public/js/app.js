document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-reboot]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-reboot');
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = 'Sending...';

      try {
        const response = await fetch(`/api/servers/${id}/reboot`, { method: 'POST' });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.message || 'Unable to reboot server.');
        }

        const badge = document.createElement('span');
        badge.className = 'ml-3 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200';
        badge.textContent = result.message;
        button.parentElement.appendChild(badge);
      } catch (error) {
        button.textContent = 'Retry';
        console.error(error);
        alert(error.message);
      } finally {
        setTimeout(() => {
          button.disabled = false;
          button.textContent = originalLabel;
        }, 1200);
      }
    });
  });
});
