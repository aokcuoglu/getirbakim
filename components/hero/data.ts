import { getPublicUrl } from '@/lib/storage/url'

export const TOP_CATEGORIES = [
  {
    id: 'car-parts',
    slug: 'car-parts',
    label: 'Car parts',
    image: '/img/3_car_parts.webp'
  },
  {
    id: 'oils',
    slug: 'oils-and-fluids',
    label: 'Oils and fluids',
    image: '/img/956_oils_and_fluids.webp'
  },
  {
    id: 'accessories',
    slug: 'accessories',
    label: 'Accessories',
    image: '/img/967_accessories_and_equipment.webp'
  }
]

export const CAMPAIGNS = [
  {
    id: 1,
    title: 'FEBI BILSTEIN',
    subtitle: 'Brake discs, brake pads, filters, and more.',
    image:
      'https://images.unsplash.com/photo-1486262715619-01b80250e0dc?q=80&w=800&auto=format&fit=crop',
    discount: 'Up to 25% off',
    color: 'bg-red-600'
  },
  {
    id: 2,
    title: 'Winter products',
    subtitle: 'Snow brushes, ice scrapers, de-icers, and more.',
    image:
      'https://images.unsplash.com/photo-1483450388569-aa47dfd42ede?q=80&w=800&auto=format&fit=crop',
    discount: 'Up to 30% off',
    color: 'bg-red-600'
  },
  {
    id: 3,
    title: 'Oil Change Bundle',
    subtitle: 'Get a free filter with 5L Castrol Edge',
    image:
      'https://images.unsplash.com/photo-1508974239320-0a029497e820?q=80&w=800&auto=format&fit=crop',
    discount: 'Bundle Deal',
    color: 'bg-primary'
  }
]

// Logo assets sourced from https://www.carlogos.org/car-brands/
export const POPULAR_MAKES = [
  {
    key: 'VW',
    label: 'Volkswagen',
    logo: getPublicUrl('vehicle-makes/volkswagen-logo.svg', 'brand-logos'),
    alt: 'Volkswagen logo'
  },
  {
    key: 'Audi',
    label: 'Audi',
    logo: getPublicUrl('vehicle-makes/audi-logo.svg', 'brand-logos'),
    alt: 'Audi logo'
  },
  {
    key: 'BMW',
    label: 'BMW',
    logo: getPublicUrl('vehicle-makes/bmw-logo.svg', 'brand-logos'),
    alt: 'BMW logo'
  },
  {
    key: 'Mercedes-Benz',
    label: 'Mercedes-Benz',
    logo: getPublicUrl(
      'vehicle-makes/mercedes-benz-logo.svg',
      'brand-logos'
    ),
    alt: 'Mercedes-Benz logo'
  },
  {
    key: 'Toyota',
    label: 'Toyota',
    logo: getPublicUrl('vehicle-makes/toyota-logo.svg', 'brand-logos'),
    alt: 'Toyota logo'
  },
  {
    key: 'Ford',
    label: 'Ford',
    logo: getPublicUrl('vehicle-makes/ford-logo.svg', 'brand-logos'),
    alt: 'Ford logo'
  },
  {
    key: 'Volvo',
    label: 'Volvo',
    logo: getPublicUrl('vehicle-makes/volvo-logo.svg', 'brand-logos'),
    alt: 'Volvo logo'
  },
  {
    key: 'Honda',
    label: 'Honda',
    logo: getPublicUrl('vehicle-makes/honda-logo.svg', 'brand-logos'),
    alt: 'Honda logo'
  }
]

export const POPULAR_MANUFACTURERS = [
  'Bosch',
  'Brembo',
  'Mann-Filter',
  'Castrol',
  'Valeo',
  'Sachs',
  'Denso',
  'Motul'
]
