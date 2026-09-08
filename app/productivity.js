// Connecteur Productivite (§7). Toutes les actions sont "Reversible"
// (§14.1) : executees librement, sans confirmation, mais journalisees.
const store = require('./store');

// task.create (§7, Reversible)
function taskCreate({ title, dueDate, priority }) {
  if (!title || !title.trim()) throw new Error('Titre de tâche manquant.');
  const task = store.createTask({ title: title.trim(), dueDate, priority });
  store.logAction({
    typeAction: 'task.create', sensibilite: 'reversible', statut: 'execute',
    details: { id: task.id, title: task.title, dueDate: task.dueDate, priority: task.priority }
  });
  return task;
}

// task.complete (§7, Reversible)
function taskComplete(id) {
  const task = store.completeTask(id);
  store.logAction({
    typeAction: 'task.complete', sensibilite: 'reversible', statut: 'execute',
    details: { id: task.id, title: task.title }
  });
  return task;
}

function taskDelete(id) {
  return store.deleteTask(id);
}

// reminder.schedule (§7, Reversible)
function reminderSchedule({ text, at, recurring }) {
  if (!text || !text.trim()) throw new Error('Texte du rappel manquant.');
  if (!at) throw new Error('Date/heure du rappel manquante.');
  const reminder = store.createReminder({ text: text.trim(), at, recurring });
  store.logAction({
    typeAction: 'reminder.schedule', sensibilite: 'reversible', statut: 'execute',
    details: { id: reminder.id, text: reminder.text, at: reminder.at, recurring: reminder.recurring }
  });
  return reminder;
}

function reminderDelete(id) {
  return store.deleteReminder(id);
}

// Verifie les rappels arrives a echeance. N'est appele que pendant
// qu'une session AURA est ouverte (F-22, §5.9) - aucune surveillance
// hors session, pas de tache planifiee au niveau du systeme.
function checkDueReminders() {
  const now = Date.now();
  const due = store.getReminders().filter((r) => r.active && new Date(r.at).getTime() <= now);
  return due.map((r) => store.markReminderFired(r.id));
}

module.exports = {
  getTasks: store.getTasks,
  taskCreate,
  taskComplete,
  taskDelete,
  getReminders: store.getReminders,
  reminderSchedule,
  reminderDelete,
  checkDueReminders
};
