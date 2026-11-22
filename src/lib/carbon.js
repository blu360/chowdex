/**
 * Carbon estimates for the directions comparison and the green-trips tally.
 *
 * These are rounded averages, good for "about how much less is this" and not for exact accounting:
 *  - a typical gasoline passenger car emits roughly 0.40 kg of CO2 per mile (the US EPA's usual figure is about 400 g/mile)
 *  - subway / transit rail emits roughly 0.10 kg of CO2 per passenger-mile (a rounded average; the real number depends on how full
 *    the train is and the electricity mix)
 *  - walking is counted as zero
 * TODO: confirm both numbers against the sources you want to cite before showing them as facts.
 */
export const CAR_KG_PER_MILE = 0.4;
export const TRANSIT_KG_PER_PASSENGER_MILE = 0.1;

export const METERS_PER_MILE = 1609.344;
export const milesFromMeters = (m) => m / METERS_PER_MILE;

/**
 * @param {{carMiles: number, transitMiles: number}} trip  the car distance and the miles actually spent on the train
 * @returns {{car_kg: number, transit_kg: number, saved_kg: number, percent: number}}
 */
export function compareEmissions({ carMiles, transitMiles }) {
  const car_kg = carMiles * CAR_KG_PER_MILE;
  const transit_kg = transitMiles * TRANSIT_KG_PER_PASSENGER_MILE;
  const saved_kg = car_kg - transit_kg;
  return {
    car_kg,
    transit_kg,
    saved_kg,
    percent: car_kg > 0 ? Math.round((100 * saved_kg) / car_kg) : 0,
  };
}
