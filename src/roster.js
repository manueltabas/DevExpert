export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 20;
export const MAX_NAME_LENGTH = 40;
export const MAX_TITLE_LENGTH = 60;

export const PLAYER_COLORS = [
  { id: "blue", label: "Blue", cssClass: "marker-blue" },
  { id: "red", label: "Red", cssClass: "marker-red" },
  { id: "yellow", label: "Yellow", cssClass: "marker-yellow" },
  { id: "green", label: "Green", cssClass: "marker-green" },
  { id: "orange", label: "Orange", cssClass: "marker-orange" },
  { id: "white", label: "White", cssClass: "marker-white" },
  { id: "black", label: "Black", cssClass: "marker-black" }
];

export function createSetupRows(count = MIN_PLAYERS) {
  return Array.from({ length: count }, (_, index) => createSetupRow(index + 1, index));
}

export function createSetupRow(sequenceNumber, colorIndex = sequenceNumber - 1) {
  return {
    id: `setup-player-${sequenceNumber}`,
    name: "",
    color: colorForIndex(colorIndex)
  };
}

export function colorForIndex(index) {
  return PLAYER_COLORS[index % PLAYER_COLORS.length].id;
}

export function getColor(colorId) {
  return PLAYER_COLORS.find((color) => color.id === colorId) ?? PLAYER_COLORS[0];
}

export function validateRoster(rows) {
  const errors = [];

  if (rows.length < MIN_PLAYERS) {
    errors.push(`Add at least ${MIN_PLAYERS} players.`);
  }

  if (rows.length > MAX_PLAYERS) {
    errors.push(`Keep the table to ${MAX_PLAYERS} players or fewer.`);
  }

  rows.forEach((row, index) => {
    const name = row.name.trim();

    if (!name) {
      errors.push(`Player ${index + 1} needs a name.`);
    }

    if (name.length > MAX_NAME_LENGTH) {
      errors.push(`Player ${index + 1}'s name must be ${MAX_NAME_LENGTH} characters or fewer.`);
    }

    if (!PLAYER_COLORS.some((color) => color.id === row.color)) {
      errors.push(`Player ${index + 1} needs one of the table colors.`);
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

export function createGame({ title, rows, now = new Date(), idSeed = "game" }) {
  const validation = validateRoster(rows);

  if (!validation.valid) {
    return { game: null, validation };
  }

  // Blank-after-trim means "no title": the trimmed title is stored verbatim
  // (possibly "") and display surfaces derive an auto label at render time.
  // Non-string input (defensive) is stored as "".
  const trimmedTitle = typeof title === "string" ? title.trim() : "";

  return {
    game: {
      id: `${idSeed}-${now.getTime()}`,
      title: trimmedTitle,
      status: "active",
      createdAt: now.toISOString(),
      players: rows.map((row, index) => ({
        id: `${idSeed}-player-${index + 1}`,
        name: row.name.trim(),
        color: row.color,
        marker: String(index + 1),
        order: index,
        total: 0
      }))
    },
    validation
  };
}
