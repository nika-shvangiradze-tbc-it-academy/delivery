import {
  SAME_CITY_DELIVERY_PRICE,
  calculateDeliveryPrice,
  getUnitDeliveryPrice,
} from './delivery-tariffs';

describe('delivery-tariffs', () => {
  it('matches published KA rates for key routes', () => {
    expect(getUnitDeliveryPrice('თბილისი', 'ბათუმი')).toBe(9);
    expect(getUnitDeliveryPrice('ბათუმი', 'თბილისი')).toBe(9);
    expect(getUnitDeliveryPrice('რუსთავი', 'ქუთაისი')).toBe(8);
  });

  it('charges 5 GEL for same-city courier', () => {
    expect(getUnitDeliveryPrice('ქუთაისი', 'ქუთაისი')).toBe(SAME_CITY_DELIVERY_PRICE);
    expect(getUnitDeliveryPrice('თბილისი', 'თბილისი')).toBe(5);
    expect(getUnitDeliveryPrice('ვანი', 'ვანი')).toBe(5);
    expect(calculateDeliveryPrice('ქუთაისი', 'ქუთაისი', 2).totalPrice).toBe(10);
  });

  it('rejects unpublished inter-city routes', () => {
    expect(getUnitDeliveryPrice('ვანი', 'თელავი')).toBeNull();
    expect(getUnitDeliveryPrice('ხაშური', 'გორი')).toBeNull();
  });

  it('multiplies unit price by parcel count', () => {
    const quote = calculateDeliveryPrice('თბილისი', 'ბათუმი', 3);
    expect(quote.status).toBe('ok');
    expect(quote.unitPrice).toBe(9);
    expect(quote.totalPrice).toBe(27);
  });
});
