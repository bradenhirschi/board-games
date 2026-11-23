/**
 * The Treasure cards, word for word from the owner's printed deck: 51 different cards, 55 in all
 * (five copies of A Pirate's Life). What each one does is in `engine.ts` (`resolveFind`); the plain
 * resource gains and losses are listed here as `gain` and `lose`.
 */

import type { Cards } from "./engine";

export type TreasureId =
  | "gambit"
  | "blackout"
  | "drinkUp"
  | "lair"
  | "godforsaken"
  | "landHo"
  | "badForm"
  | "skewer"
  | "castaway"
  | "royalNavy"
  | "bootleg"
  | "manOverboard"
  | "baited"
  | "arrr"
  | "vermin"
  | "theLocker"
  | "trove"
  | "plunder"
  | "theKraken"
  | "messageInABottle"
  | "berth"
  | "cannonball"
  | "cutlass"
  | "windAtYourBack"
  | "hoistTheMizzen"
  | "iAmTheStorm"
  | "mutiny"
  | "tellNoTales"
  | "scurvy"
  | "loot"
  | "greatWhite"
  | "whiteFlag"
  | "hailToTheThief"
  | "dinghy"
  | "aPiratesLife"
  | "sorrow"
  | "pegLegs"
  | "takeover"
  | "theGallows"
  | "salvage"
  | "purse"
  | "mirage"
  | "midas"
  | "cargo"
  | "chest"
  | "standoff"
  | "cursed"
  | "pillage"
  | "notorious"
  | "doubloons"
  | "walkThePlank";

export type TreasureCard = {
  title: string;
  /** The italic story line. */
  flavor: string;
  /** What to do, as printed (each string is a line; "OR" separates the two choices). */
  text: string[];
  /** Resource cards gained and lost every time (taken from and returned to the supply). */
  gain?: Cards;
  lose?: Cards;
  /** Copies in the deck (one unless said). */
  copies?: number;
};

export const TREASURE_CARDS: Record<TreasureId, TreasureCard> = {
  gambit: {
    title: "Gambit",
    flavor: "Ye keep yer restless crew at bay with yer own gold in hopes of finding more.",
    text: ["Roll a die.", "4 or higher doubles your gold.", "Anything lower, lose all your gold."],
  },
  blackout: {
    title: "Blackout",
    flavor: "This haul be barrels of liquid goodness. Ye celebrate too hard and fall asleep at the helm.",
    text: ["+3 Rum", "Use the compasses to relocate your ship. Your turn is now over."],
    gain: { rum: 3 },
  },
  drinkUp: {
    title: "Drink Up",
    flavor: "Ye find barrels of booze floating adrift. Waste not a drop nor a stave.",
    text: ["+1 Wood", "+1 Rum"],
    gain: { wood: 1, rum: 1 },
  },
  lair: {
    title: "Lair",
    flavor: "Yer opponent’s secret hideout be no longer secret.",
    text: ["Choose an enemy player to give you all their gold."],
  },
  godforsaken: {
    title: "Godforsaken",
    flavor: "No treasure and no wind. Ye might be here awhile. Yer resources dwindle.",
    text: ["Roll a die.", "Lose that number of Resource cards.", "You choose which cards."],
  },
  landHo: {
    title: "Land Ho",
    flavor: "This chest contains a sea chart which leads ta undiscovered soil.",
    text: ["Move your ship to an accessible port of any unowned island."],
  },
  badForm: {
    title: "Bad Form",
    flavor: "They trusted ye ta keep their stash safe but ye have no loyalties.",
    text: ["Steal one Resource card from every enemy player."],
  },
  skewer: {
    title: "Skewer",
    flavor: "The landlubber who lead ye ta this empty trove be impaled as a warnin ta others.",
    text: ["-1 Iron"],
    lose: { iron: 1 },
  },
  castaway: {
    title: "Castaway",
    flavor: "Ye find some scallywags left fer dead. They happily join yer ranks.",
    text: ["Add a life to any ship in your fleet."],
  },
  royalNavy: {
    title: "Royal Navy",
    flavor: "Yer pirating ways be not appreciated. Perhaps a bribe will stay their guns.",
    text: ["Your ship loses a life unless you choose to lose all your gold.", "If you have no gold, lose a life."],
  },
  bootleg: {
    title: "Bootleg",
    flavor: "Ye ransack a band of rum runners. A drunk crew be a happy crew.",
    text: ["+2 Rum"],
    gain: { rum: 2 },
  },
  manOverboard: {
    title: "Man Overboard",
    flavor: "Yer lookout be tossed from the crow’s nest. Save the sailor or stay on course fer gold.",
    text: ["+3 Gold and your ship loses a life.", "OR", "End your turn."],
  },
  baited: {
    title: "Baited",
    flavor: "Ye found naught here so ye laid in wait for another treasure seeker.",
    text: ["Steal two Resource cards from an enemy player."],
  },
  arrr: {
    title: "Arrr",
    flavor: "Howls from yer crew scare a passing ship from the treasure.",
    text: ["+2 Gold", "Move an enemy ship up to three spaces."],
    gain: { gold: 2 },
  },
  vermin: {
    title: "Vermin",
    flavor: "Where treasure lived thar now be rats. Ye set em ablaze fer fear of plague.",
    text: ["-1 Rum"],
    lose: { rum: 1 },
  },
  theLocker: {
    title: "The Locker",
    flavor: "Those who stand between ye and treasure be sent ta the bottom.",
    text: ["+2 Gold", "Choose an enemy ship to lose a life.", "(If enemy ship sinks do not gain a Plunder Point.)"],
    gain: { gold: 2 },
  },
  trove: {
    title: "Trove",
    flavor: "Good fortune finds ye when the changing tide reveals a cave of riches.",
    text: ["+4 Gold"],
    gain: { gold: 4 },
  },
  plunder: {
    title: "Plunder",
    flavor: "These waters be not fer the weak. No treasure be safe.",
    text: ["Steal one Plunder Point card from an enemy player."],
  },
  theKraken: {
    title: "The Kraken",
    flavor: "Ye fashion harpoons ta kill the monster guardin this treasure.",
    text: ["-1 Wood", "-2 Iron", "+4 Gold"],
    gain: { gold: 4 },
    lose: { wood: 1, iron: 2 },
  },
  messageInABottle: {
    title: "Message in a Bottle",
    flavor: "A floating missive tells the whereabouts of a pirate’s secret stash.",
    text: ["Steal three Resource cards from an enemy player."],
  },
  berth: {
    title: "Berth",
    flavor: "After a fine haul yer weary sea legs could do with a bit of rest.",
    text: ["+2 Gold", "Dock your ship in any accessible port. Your turn is now over."],
    gain: { gold: 2 },
  },
  cannonball: {
    title: "Cannonball",
    flavor: "Yer divers discover some rusted artillery on the seabed.",
    text: ["Add one cannon to any ship in your fleet."],
  },
  cutlass: {
    title: "Cutlass",
    flavor: "Ye slay the dogs guardin this treasure and melt down their weapons.",
    text: ["+2 Iron", "+1 Gold"],
    gain: { iron: 2, gold: 1 },
  },
  windAtYourBack: {
    title: "Wind at Your Back",
    flavor: "Not only do ye find treasure but the breeze be in yer favor.",
    text: ["+2 Gold", "Move your ship up to three additional spaces."],
    gain: { gold: 2 },
  },
  hoistTheMizzen: {
    title: "Hoist the Mizzen",
    flavor: "Seems another ship lost its sail in the storm. Now it be yers.",
    text: ["Add one mast to any ship in your fleet."],
  },
  iAmTheStorm: {
    title: "I Am the Storm",
    flavor: "Yer fake map tricks a foe away from this bounty and into treacherous waters.",
    text: ["+2 Gold", "Place an enemy ship inside the storm."],
    gain: { gold: 2 },
  },
  mutiny: {
    title: "Mutiny",
    flavor: "With no treasure found, yer crew grows unruly. Squashin rebellions be costly.",
    text: ["-1 Iron", "-1 Rum", "-1 Gold"],
    lose: { iron: 1, rum: 1, gold: 1 },
  },
  tellNoTales: {
    title: "Tell No Tales",
    flavor: "Ye make sure only ye know where this treasure be.",
    text: ["+3 Gold", "Choose an enemy ship to lose a life.", "(If enemy ship sinks do not gain a Plunder Point.)"],
    gain: { gold: 3 },
  },
  scurvy: {
    title: "Scurvy",
    flavor: "Ye reach the treasure but yer voyage be plagued by sickness.",
    text: ["+3 Gold", "Your ship loses a life."],
    gain: { gold: 3 },
  },
  loot: {
    title: "Loot",
    flavor: "Ye intercept a supply run meant fer yer foes and take fer yerself.",
    text: ["All enemy players must hand you all of a resource of your choosing."],
  },
  greatWhite: {
    title: "Great White",
    flavor: "This treasure be in shark-infested waters. Ye treat wounds with alcohol and a hot blade.",
    text: ["-1 Iron", "-1 Rum", "+3 Gold"],
    gain: { gold: 3 },
    lose: { iron: 1, rum: 1 },
  },
  whiteFlag: {
    title: "White Flag",
    flavor: "Ye gain the upper hand on yer foe. Ye might let the dog live fer a price.",
    text: [
      "Choose an enemy player to offer you a bribe. Accept, or remove a life from their fleet.",
      "(If enemy ship sinks do not gain a Plunder Point.)",
    ],
  },
  hailToTheThief: {
    title: "Hail to the Thief",
    flavor: "No pirate’s bounty be safe from yer grasp.",
    text: ["All enemy players must give you all their gold."],
  },
  dinghy: {
    title: "Dinghy",
    flavor: "Ye find an abandoned rowboat so ye dismantle it fer parts.",
    text: ["+2 Wood", "+1 Iron"],
    gain: { wood: 2, iron: 1 },
  },
  aPiratesLife: {
    title: "A Pirate’s Life",
    flavor: "Ye find the greatest treasure of all.",
    text: ["+1 Plunder Point"],
    copies: 5,
  },
  sorrow: {
    title: "Sorrow",
    flavor: "This chest be empty and morale be low. Ye let the crew wet their pipe.",
    text: ["-2 Rum"],
    lose: { rum: 2 },
  },
  pegLegs: {
    title: "Peg Legs",
    flavor: "The battle fer this treasure cost yer crew some limbs. They’ll learn ta live with splinters.",
    text: ["-1 Wood", "+3 Gold"],
    gain: { gold: 3 },
    lose: { wood: 1 },
  },
  takeover: {
    title: "Takeover",
    flavor: "A distant shore catches yer eye. Yer enemy prefers relocation ta death.",
    text: ["If you so choose, swap one of your islands with an enemy player’s island."],
  },
  theGallows: {
    title: "The Gallows",
    flavor: "Scavengers try ta take yer new fortune so ye give em a short drop and a sudden stop.",
    text: ["-2 Wood", "+3 Gold"],
    gain: { gold: 3 },
    lose: { wood: 2 },
  },
  salvage: {
    title: "Salvage",
    flavor: "Ye discover the remains of a wrecked ship. Thar be plenty of debris ta scavenge.",
    text: ["+2 Wood", "+2 Iron"],
    gain: { wood: 2, iron: 2 },
  },
  purse: {
    title: "Purse",
    flavor: "The skeleton clutchin this treasure wont be missin it.",
    text: ["+2 Gold"],
    gain: { gold: 2 },
  },
  mirage: {
    title: "Mirage",
    flavor: "Ye spy treasure but what ye really spy be nuthin.",
    text: ["Your turn is now over."],
  },
  midas: {
    title: "Midas",
    flavor: "If it’s gold ye want, it’s gold ye get. Ye be touched by an ancient curse.",
    text: ["Swap out all the resources in your hand for gold."],
  },
  cargo: {
    title: "Cargo",
    flavor: "Ye raid a supply scow and leave em dry and adrift.",
    text: ["+1 Wood", "+1 Iron", "+1 Rum"],
    gain: { wood: 1, iron: 1, rum: 1 },
  },
  chest: {
    title: "Chest",
    flavor: "Filled with riches this trunk be. Enjoy yer spoils.",
    text: ["+3 Gold"],
    gain: { gold: 3 },
  },
  standoff: {
    title: "Standoff",
    flavor: "Yer caught lootin another captain’s lair. A battle for gold be waged.",
    text: [
      "Choose an enemy player.",
      "You both roll a die.",
      "Highest number wins the other’s gold.",
      "Tie goes to you.",
    ],
  },
  cursed: {
    title: "Cursed",
    flavor: "This chest be carved with a warnin but ye pay no heed. Suffer the price fer yer greed.",
    text: ["+4 Gold", "Your ship loses a life."],
    gain: { gold: 4 },
  },
  pillage: {
    title: "Pillage",
    flavor: "Ye take what ye need then take more.",
    text: ["+1 Wood", "+1 Iron", "+1 Gold"],
    gain: { wood: 1, iron: 1, gold: 1 },
  },
  notorious: {
    title: "Notorious",
    flavor: "Yer fame and legend grow with every haul. Sailors hasten ta join yer crew.",
    text: [
      "+1 Gold",
      "Steal a life from an enemy ship and add it to your fleet.",
      "(If enemy ship sinks do not gain a Plunder Point.)",
    ],
    gain: { gold: 1 },
  },
  doubloons: {
    title: "Doubloons",
    flavor: "Ye vow ta empty these seas of every last coin.",
    text: ["+1 Gold"],
    gain: { gold: 1 },
  },
  walkThePlank: {
    title: "Walk the Plank",
    flavor: "Pockets now filled with gold, a swabber wants to start fer home. Ye oblige em.",
    text: ["-1 Wood", "+2 Gold"],
    gain: { gold: 2 },
    lose: { wood: 1 },
  },
};

/** The whole deck, unshuffled: every card once, A Pirate's Life five times (55 cards). */
export const TREASURE_DECK: TreasureId[] = (Object.keys(TREASURE_CARDS) as TreasureId[]).flatMap((id) =>
  Array<TreasureId>(TREASURE_CARDS[id].copies ?? 1).fill(id),
);
