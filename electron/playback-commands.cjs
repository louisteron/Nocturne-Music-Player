// Conserver l’ordre des commandes, tout en interrompant immédiatement play()
// si son attente de tampon doit être annulée par pause.
function createCommandQueue(interrupt) {
  let sequence = Promise.resolve(), generation = 0;
  return {
    run(action, execute) {
      let interrupted;
      if (action === 'pause') { generation++; interrupted = Promise.resolve().then(interrupt).catch(() => {}); }
      const request = generation;
      const job = sequence.catch(() => {}).then(async () => {
        if (request !== generation) return { cancelled: true };
        if (interrupted) await interrupted;
        return execute();
      });
      sequence = job.catch(() => {});
      return job;
    }
  };
}
module.exports = { createCommandQueue };
