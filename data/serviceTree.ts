import { squareMappingFor } from "@/data/squareServiceMap";

export type ServiceAddOnKey = "length-ml" | "over-3-weeks" | "extra-callus-remover" | "extra-calcium-gel";

export type ServiceAddOn = {
  key: ServiceAddOnKey;
  nameEn: string;
  nameFr: string;
  priceCad: number;
  labelEn: string;
  labelFr: string;
  durationMinutes: number;
};

export type ServiceLeaf = {
  type: "service";
  id: string;
  name: string;
  nameEn: string;
  nameFr: string;
  price: number;
  priceCad: number;
  priceLabel?: string;
  durationMinutes: number;
  addOn?: ServiceAddOn;
  squareVariationId?: string;
  displayNameEn?: string;
  displayNameFr?: string;
};

export type ServiceBranch = {
  type: "branch";
  id: string;
  nameEn: string;
  nameFr: string;
  noteEn?: string;
  noteFr?: string;
  children: ServiceNode[];
};

export type ServiceNode = ServiceBranch | ServiceLeaf;

const branch = (id: string, nameEn: string, nameFr: string, children: ServiceNode[], noteEn?: string, noteFr?: string): ServiceBranch => ({ type: "branch", id, nameEn, nameFr, children, ...(noteEn ? { noteEn } : {}), ...(noteFr ? { noteFr } : {}) });
const service = (id: string, nameEn: string, nameFr: string, price: number, durationMinutes: number, priceLabel?: string, addOn?: ServiceAddOn): ServiceLeaf => ({ type: "service", id, name: nameEn, nameEn, nameFr, price, priceCad: price, durationMinutes, ...(priceLabel ? { priceLabel } : {}), ...(addOn ? { addOn } : {}) });
/** Every surcharge toggle adds this much time on top of the variation's base duration. */
export const SURCHARGE_EXTRA_MINUTES = 15;

const surcharge = (key: ServiceAddOnKey, nameEn: string, nameFr: string, basePrice: number, priceCad: number): ServiceAddOn => ({
  key,
  nameEn,
  nameFr,
  priceCad,
  labelEn: `${nameEn}, $${basePrice + priceCad} (+$${priceCad} · +${SURCHARGE_EXTRA_MINUTES} min)`,
  labelFr: `${nameFr}, ${basePrice + priceCad} $ (+${priceCad} $ · +${SURCHARGE_EXTRA_MINUTES} min)`,
  durationMinutes: SURCHARGE_EXTRA_MINUTES,
});
const lengthMlAddOn = (basePrice: number) => surcharge("length-ml", "M/L", "M/L", basePrice, 10);
const overThreeWeeksAddOn = (basePrice: number) => surcharge("over-3-weeks", "If nails over 3 weeks", "Ongles de plus de 3 semaines", basePrice, 5);
const extraCallusRemoverAddOn = (basePrice: number) => surcharge("extra-callus-remover", "Extra callus remover", "Soin anti-callosités supplémentaire", basePrice, 20);
const extraCalciumGelAddOn = (basePrice: number) => surcharge("extra-calcium-gel", "Extra Strong Calcium gel", "Gel calcium extra-fort", basePrice, 5);

export const serviceTree: ServiceBranch[] = [
  branch("hands", "Hands", "Mains", [
    branch("natural-nails", "Natural nails", "Ongles naturels", [
      branch("manicure", "Manicure", "Manucure", [
        service("hands-manicure-no-polish", "No polish", "Sans vernis", 20, 15),
        service("hands-manicure-regular-polish", "Regular polish", "Vernis classique", 25, 20),
        service("hands-manicure-shellac", "Shellac", "Shellac", 35, 20, undefined, extraCalciumGelAddOn(35)),
      ]),
      branch("natural-nails-touch-up", "Touch-up", "Retouche", [
        service("hands-touch-up-regular", "Regular", "Classique", 18, 15),
        service("hands-touch-up-shellac", "Shellac", "Shellac", 30, 20, undefined, extraCalciumGelAddOn(30)),
      ]),
    ]),
    branch("nail-enhancement", "Nail Enhancement (Acrylic, Builder gel, Gel X)", "Extensions (acrylique, gel de construction, Gel X)", [
      branch("enhancement-new-set", "New set", "Nouvelle pose", [
        service("enhancement-new-no-polish", "No polish", "Sans vernis", 40, 60, undefined, lengthMlAddOn(40)),
        service("enhancement-new-regular-polish", "Regular polish", "Vernis classique", 50, 60, undefined, lengthMlAddOn(50)),
        service("enhancement-new-shellac", "Shellac", "Shellac", 55, 60, undefined, lengthMlAddOn(55)),
      ], "M/L +$10 · +15 mins", "M/L +10 $ · +15 min"),
      branch("enhancement-refill", "Refill", "Remplissage", [
        service("enhancement-refill-no-polish", "No polish", "Sans vernis", 32, 50, undefined, overThreeWeeksAddOn(32)),
        service("enhancement-refill-regular-polish", "Regular polish", "Vernis classique", 42, 50, undefined, overThreeWeeksAddOn(42)),
        service("enhancement-refill-shellac", "Shellac", "Shellac", 47, 50, undefined, overThreeWeeksAddOn(47)),
      ], "If nails over 3 weeks +$5 · +15 mins", "Ongles de plus de 3 semaines +5 $ · +15 min"),
    ]),
  ]),
  branch("feet", "Feets", "Pieds", [
    branch("pedicure", "Pedicure", "Pédicure", [
      service("feet-pedicure-no-polish", "No polish", "Sans vernis", 35, 30, undefined, extraCallusRemoverAddOn(35)),
      service("feet-pedicure-regular-polish", "Regular polish", "Vernis classique", 40, 35, undefined, extraCallusRemoverAddOn(40)),
      service("feet-pedicure-shellac", "Shellac", "Shellac", 50, 35, undefined, extraCallusRemoverAddOn(50)),
    ], "Extra callus remover +$20 · +15 mins", "Soin anti-callosités supplémentaire +20 $ · +15 min"),
    branch("feet-touch-up", "Touch-up", "Retouche", [
      service("feet-touch-up-regular-polish", "Regular polish", "Vernis classique", 22, 15),
      service("feet-touch-up-shellac", "Shellac", "Shellac", 32, 20),
    ]),
  ]),
  branch("variable-add-ons", "Option add-on", "Options / suppléments", [
    branch("removal", "Removal", "Dépose", [
      service("removal-shellac", "Shellac", "Shellac", 15, 15),
      service("removal-enhancement", "Enhancement nails", "Extensions", 20, 30),
    ]),
    branch("repair", "Repair", "Réparation", [
      service("repair-1-2-nails", "1-2 nails", "1 à 2 ongles", 10, 15),
      service("repair-5-nails-plus", "5 nails +", "5 ongles et plus", 15, 25),
    ]),
    branch("cut-nails", "Cut nails", "Coupe des ongles", [
      service("cut-nails-option-1", "Option 1", "Option 1", 15, 10),
      service("cut-nails-option-2", "Option 2", "Option 2", 20, 10),
    ]),
    branch("treatment", "Treatment", "Soin", [
      branch("paraffin", "Paraffin", "Paraffine", [
        service("treatment-paraffin-feet", "Feets", "Pieds", 15, 10),
        service("treatment-paraffin-hands", "Hands", "Mains", 12, 10),
      ]),
      service("treatment-collagen", "Collagen", "Collagène", 10, 10),
      service("treatment-extra-callus-remover-heels", "Extra Callus Remover Heels", "Callosités talons", 20, 15),
      service("treatment-extra-calcium-strong-gel", "Extra Calcium Strong Gel", "Supplément Gel Calcium Renforcé", 10, 15),
    ]),
    branch("add-on", "Add-on", "Supplément", [
      service("add-on-basic-art", "Basic art — french, simple line, dots", "Décor simple : french, lignes, pois", 10, 15),
      service("add-on-chrome-cat-eye", "Chrome, cat eye", "Chrome, œil de chat", 15, 15),
      service("add-on-custom-art", "Hand painting 3D charms, custom", "Peinture à main levée, décor 3D, création sur mesure", 25, 45, "$25+"),
      service("add-on-cuticle-clean-up", "Cuticle clean-up", "Nettoyage des cuticules", 10, 5),
    ]),
  ]),
  branch("waxing", "Waxing", "Épilation", [
    branch("waxing-body", "Body", "Corps", [
      service("waxing-underarm", "Under arm", "Aisselles", 15, 10),
      branch("waxing-arm", "Arm", "Bras", [
        service("waxing-half-arm", "Half arm", "Demi-bras", 25, 20),
        service("waxing-full-arm", "Full arm", "Bras complet", 30, 25),
      ]),
      service("waxing-back", "Back", "Dos", 35, 30),
      branch("waxing-chest", "Chest", "Torse", [
        service("waxing-half-chest", "Half chest", "Demi-torse", 25, 15),
        service("waxing-full-chest", "Full chest", "Torse complet", 40, 25),
      ]),
      branch("waxing-leg", "Leg", "Jambe", [
        service("waxing-half-leg", "Half leg", "Demi-jambe", 30, 20),
        service("waxing-half-leg-extra", "Half leg extra time", "Demi-jambe, temps supplémentaire", 35, 25),
        service("waxing-full-leg", "Full leg", "Jambe complète", 40, 30),
        service("waxing-full-leg-extra", "Full leg extra time", "Jambe complète, temps supplémentaire", 45, 35),
      ]),
      service("waxing-neck", "Neck", "Cou", 15, 15),
    ]),
    branch("waxing-facial", "Facial", "Visage", [
      service("waxing-chin", "Chin", "Menton", 15, 10),
      service("waxing-upper-lip", "Upper lip", "Lèvre supérieure", 10, 5),
      service("waxing-eyebrow", "Eyebrow", "Sourcils", 12, 10),
    ]),
    branch("waxing-intimate", "Intimate", "Intime", [
      branch("waxing-bikini", "Bikini", "Maillot", [
        service("waxing-bikini-line", "Line", "Contour", 20, 15),
        service("waxing-bikini-full", "Full", "Complet", 30, 25),
      ]),
      branch("waxing-brazilian", "Brazilian", "Brésilien", [
        service("waxing-brazilian-regular", "Regular time", "Durée classique", 40, 30),
        service("waxing-brazilian-extra", "Extra time", "Temps supplémentaire", 45, 35),
      ]),
    ]),
  ]),
];

const DISPLAY_PATH_OVERRIDES: Record<string, { en: string; fr: string }> = {
  "hands-manicure-no-polish": { en: "Manicure / No polish", fr: "Manucure / Sans vernis" },
  "hands-manicure-regular-polish": { en: "Manicure / Regular polish", fr: "Manucure / Vernis classique" },
  "hands-manicure-shellac": { en: "Manicure / Shellac", fr: "Manucure / Shellac" },
  "hands-touch-up-regular": { en: "Hands / Touch-up / Regular", fr: "Mains / Retouche / Classique" },
  "hands-touch-up-shellac": { en: "Hands / Touch-up / Shellac", fr: "Mains / Retouche / Shellac" },
  "enhancement-new-no-polish": { en: "New set / No polish", fr: "Nouvelle pose / Sans vernis" },
  "enhancement-new-regular-polish": { en: "New set / Regular polish", fr: "Nouvelle pose / Vernis classique" },
  "enhancement-new-shellac": { en: "New set / Shellac", fr: "Nouvelle pose / Shellac" },
  "enhancement-refill-no-polish": { en: "Refill / No polish", fr: "Remplissage / Sans vernis" },
  "enhancement-refill-regular-polish": { en: "Refill / Regular polish", fr: "Remplissage / Vernis classique" },
  "enhancement-refill-shellac": { en: "Refill / Shellac", fr: "Remplissage / Shellac" },
  "feet-pedicure-no-polish": { en: "Pedicure / No polish", fr: "Pédicure / Sans vernis" },
  "feet-pedicure-regular-polish": { en: "Pedicure / Regular polish", fr: "Pédicure / Vernis classique" },
  "feet-pedicure-shellac": { en: "Pedicure / Shellac", fr: "Pédicure / Shellac" },
  "feet-touch-up-regular-polish": { en: "Feet / Touch-up / Regular polish", fr: "Pieds / Retouche / Vernis classique" },
  "feet-touch-up-shellac": { en: "Feet / Touch-up / Shellac", fr: "Pieds / Retouche / Shellac" },
  "removal-shellac": { en: "removal / Shellac", fr: "Dépose / Shellac" },
  "removal-enhancement": { en: "removal / Enhancement nails", fr: "Dépose / Extensions" },
  "repair-1-2-nails": { en: "Repair / 1-2 nails", fr: "Réparation / 1 à 2 ongles" },
  "repair-5-nails-plus": { en: "Repair / 5 nails +", fr: "Réparation / 5 ongles et plus" },
  "cut-nails-option-1": { en: "Cut nails / Option 1", fr: "Coupe des ongles / Option 1" },
  "cut-nails-option-2": { en: "Cut nails / Option 2", fr: "Coupe des ongles / Option 2" },
  "treatment-paraffin-feet": { en: "Treatment / Paraffin / Feets", fr: "Soin / Paraffine / Pieds" },
  "treatment-paraffin-hands": { en: "Treatment / Paraffin / Hands", fr: "Soin / Paraffine / Mains" },
  "treatment-collagen": { en: "Treatment / Collagen", fr: "Soin / Collagène" },
  "treatment-extra-callus-remover-heels": { en: "Treatment / Extra Callus Remover Heels", fr: "Soin / Callosités talons" },
  "treatment-extra-calcium-strong-gel": { en: "Treatment / Extra Calcium Strong Gel", fr: "Soin / Supplément Gel Calcium Renforcé" },
  "add-on-basic-art": { en: "Add-on / Basic art — french, simple line, dots", fr: "Supplément / Décor simple (French, lignes, pois)" },
  "add-on-chrome-cat-eye": { en: "Add-on / Chrome, cat eye", fr: "Supplément / Chrome, œil de chat" },
  "add-on-custom-art": { en: "Add-on / Hand painting 3D charms, custom", fr: "Supplément / Peinture à main levée, décor 3D, création sur mesure" },
  "add-on-cuticle-clean-up": { en: "Add-on / Cuticle clean-up", fr: "Supplément / Nettoyage des cuticules" },
};

function buildPath(node: ServiceNode, parents: ServiceBranch[], language: "en" | "fr") {
  const segments = [...parents.map((parent) => language === "en" ? parent.nameEn : parent.nameFr), language === "en" ? node.nameEn : node.nameFr];
  if (node.type === "service" && node.id.startsWith("waxing-")) return segments.join(" / ");

  if (node.type === "service" && parents.some((parent) => parent.id === "hands")) {
    const omit = new Set(["hands", "natural-nails", "nail-enhancement"]);
    return segments.filter((_, index) => !omit.has(parents[index]?.id)).join(" / ");
  }
  if (node.type === "service" && parents.some((parent) => parent.id === "feet")) {
    return segments.filter((_, index) => parents[index]?.id !== "feet").join(" / ");
  }
  return segments.join(" / ");
}

function assignDisplayPaths(nodes: ServiceNode[], parents: ServiceBranch[] = []) {
  for (const node of nodes) {
    if (node.type === "branch") {
      assignDisplayPaths(node.children, [...parents, node]);
    } else {
      const override = DISPLAY_PATH_OVERRIDES[node.id];
      node.displayNameEn = override?.en ?? buildPath(node, parents, "en");
      node.displayNameFr = override?.fr ?? buildPath(node, parents, "fr");
      const squareMapping = squareMappingFor(node.id);
      if (squareMapping) node.squareVariationId = squareMapping.variationId;
    }
  }
}

assignDisplayPaths(serviceTree);

export function serviceDisplayName(service: ServiceLeaf, language: "en" | "fr") {
  return language === "en" ? service.displayNameEn ?? service.nameEn : service.displayNameFr ?? service.nameFr;
}

export function selectedServicePrice(service: ServiceLeaf, addOnKey?: ServiceAddOnKey) {
  return service.priceCad + (service.addOn && service.addOn.key === addOnKey ? service.addOn.priceCad : 0);
}

export function selectedServiceDuration(service: ServiceLeaf, addOnKey?: ServiceAddOnKey) {
  return service.durationMinutes + (service.addOn && service.addOn.key === addOnKey ? service.addOn.durationMinutes : 0);
}

export function serviceDisplayNameWithAddOn(service: ServiceLeaf, language: "en" | "fr", addOnKey?: ServiceAddOnKey) {
  const baseName = serviceDisplayName(service, language);
  if (!service.addOn || service.addOn.key !== addOnKey) return baseName;
  const addOnName = language === "en" ? service.addOn.nameEn : service.addOn.nameFr;
  return `${baseName} + ${addOnName}`;
}

export function flattenServices(nodes: ServiceNode[] = serviceTree): ServiceLeaf[] {
  return nodes.flatMap((node) => node.type === "service" ? [node] : flattenServices(node.children));
}

export const allServices = flattenServices();
export const serviceById = new Map(allServices.map((serviceItem) => [serviceItem.id, serviceItem]));
