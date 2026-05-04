export interface CategoryNode {
  id: string
  slug: string
  label: string
  iconName?: string
  image?: string
  children?: CategoryNode[]
}

// Top-level categories matching Hero.tsx
export const TOP_LEVEL_CATEGORIES: CategoryNode[] = [
  {
    id: 'car-parts',
    slug: 'car-parts',
    label: 'Araç Parçaları',
    image: '/img/3_car_parts.webp',
    children: [
      {
        id: 'brake_system',
        slug: 'brake-system',
        label: 'Brake system',
        iconName: 'Disc',
        image: '/img/categories/brake_system.webp',
        children: [
          {
            id: 'brake_discs',
            slug: 'brake-discs',
            label: 'Brake discs',
            iconName: 'Disc'
          },
          {
            id: 'brake_pads',
            slug: 'brake-pads',
            label: 'Brake pads',
            iconName: 'Disc'
          },
          {
            id: 'brake_calipers',
            slug: 'brake-calipers',
            label: 'Brake calipers',
            iconName: 'Disc'
          },
          {
            id: 'brake_accessories',
            slug: 'brake-accessories',
            label: 'Brake system accessories',
            iconName: 'Disc'
          },
          {
            id: 'brake_indicators',
            slug: 'brake-indicators',
            label: 'Brake pad wear indicators',
            iconName: 'Disc'
          },
          {
            id: 'caliper_parts',
            slug: 'caliper-parts',
            label: 'Brake caliper parts',
            iconName: 'Disc'
          },
          {
            id: 'handbrake_parts',
            slug: 'handbrake-parts',
            label: 'Handbrake parts',
            iconName: 'Disc'
          },
          {
            id: 'brake_drums',
            slug: 'brake-drums',
            label: 'Brake drums',
            iconName: 'Disc'
          },
          {
            id: 'brake_shoes',
            slug: 'brake-shoes',
            label: 'Brake shoes',
            iconName: 'Disc'
          },
          {
            id: 'wheel_cylinders',
            slug: 'wheel-cylinders',
            label: 'Wheel brake cylinders',
            iconName: 'Disc'
          },
          {
            id: 'drum_parts',
            slug: 'drum-parts',
            label: 'Drum brake parts',
            iconName: 'Disc'
          },
          {
            id: 'abs_sensors',
            slug: 'abs-sensors',
            label: 'ABS sensors and rings',
            iconName: 'Disc'
          },
          {
            id: 'master_cylinders',
            slug: 'master-cylinders',
            label: 'Brake master cylinders',
            iconName: 'Disc'
          },
          {
            id: 'brake_hoses',
            slug: 'brake-hoses',
            label: 'Brake hoses',
            iconName: 'Disc'
          },
          {
            id: 'parking_cables',
            slug: 'parking-cables',
            label: 'Parking brake cables',
            iconName: 'Disc'
          },
          {
            id: 'line_fittings',
            slug: 'line-fittings',
            label: 'Brake line fittings',
            iconName: 'Disc'
          },
          {
            id: 'brake_boosters',
            slug: 'brake-boosters',
            label: 'Brake boosters',
            iconName: 'Disc'
          },
          {
            id: 'power_regulator',
            slug: 'power-regulator',
            label: 'Brake power regulator',
            iconName: 'Disc'
          },
          {
            id: 'brake_lines',
            slug: 'brake-lines',
            label: 'Brake lines',
            iconName: 'Disc'
          }
        ]
      },
      {
        id: 'filters',
        slug: 'filters',
        label: 'Filters',
        iconName: 'Filter',
        image: '/img/categories/filters.webp',
        children: [
          {
            id: 'oil_filter',
            slug: 'oil-filters',
            label: 'Oil filter',
            iconName: 'Filter'
          },
          {
            id: 'air_filter',
            slug: 'air-filters',
            label: 'Air filter',
            iconName: 'Filter'
          },
          {
            id: 'cabin_filter',
            slug: 'cabin-filters',
            label: 'Cabin filter',
            iconName: 'Filter'
          },
          {
            id: 'fuel_filter',
            slug: 'fuel-filters',
            label: 'Fuel filter',
            iconName: 'Filter'
          }
        ]
      },
      {
        id: 'suspension',
        slug: 'suspension',
        label: 'Suspension',
        iconName: 'Orbit',
        image: '/img/categories/suspension.webp',
        children: [
          {
            id: 'shock_absorbers',
            slug: 'shock-absorbers',
            label: 'Shock absorbers',
            iconName: 'Orbit'
          },
          {
            id: 'springs',
            slug: 'suspension-springs',
            label: 'Suspension springs',
            iconName: 'Orbit'
          },
          {
            id: 'control_arms',
            slug: 'control-arms',
            label: 'Control arms',
            iconName: 'Orbit'
          }
        ]
      },
      {
        id: 'steering',
        slug: 'steering',
        label: 'Steering',
        iconName: 'Move3d',
        image: '/img/categories/steering.webp',
        children: []
      },
      {
        id: 'wipers_washers',
        slug: 'wipers-and-washers',
        label: 'Wipers and washers',
        iconName: 'Droplets',
        image: '/img/categories/wipers.webp',
        children: []
      },
      {
        id: 'engine_parts',
        slug: 'engine-parts',
        label: 'Engine parts',
        iconName: 'Cog',
        image: '/img/categories/engine.webp',
        children: []
      },
      {
        id: 'fuel_system',
        slug: 'fuel-system',
        label: 'Fuel system',
        iconName: 'Droplets',
        image: '/img/categories/fuel.webp',
        children: []
      },
      {
        id: 'exhaust_system',
        slug: 'exhaust-system',
        label: 'Exhaust system',
        iconName: 'Fan',
        image: '/img/categories/exhaust.webp',
        children: []
      },
      {
        id: 'electric_system',
        slug: 'electric-system',
        label: 'Electric system',
        iconName: 'Zap',
        image: '/img/categories/electric.webp',
        children: []
      },
      {
        id: 'engine_cooling',
        slug: 'engine-cooling',
        label: 'Engine cooling',
        iconName: 'Thermometer',
        image: '/img/categories/cooling.webp',
        children: []
      }
    ]
  },
  {
    id: 'wipers',
    slug: 'wiper-blades',
    label: 'Silecek Süpürgeleri',
    image: '/img/607_windscreen_wipers.webp',
    children: [
      {
        id: 'front_wipers',
        slug: 'front-wipers',
        label: 'Front Wipers',
        iconName: 'Wind'
      },
      {
        id: 'rear_wipers',
        slug: 'rear-wipers',
        label: 'Rear Wipers',
        iconName: 'Wind'
      },
      {
        id: 'wiper_arms',
        slug: 'wiper-arms',
        label: 'Wiper Arms',
        iconName: 'Settings'
      },
      {
        id: 'washer_pumps',
        slug: 'washer-pumps',
        label: 'Washer Pumps',
        iconName: 'Zap'
      }
    ]
  },
  {
    id: 'oils',
    slug: 'oils-and-fluids',
    label: 'Yağlar ve Sıvılar',
    image: '/img/956_oils_and_fluids.webp',
    children: [
      {
        id: 'engine_oil',
        slug: 'engine-oil',
        label: 'Engine Oil',
        iconName: 'Droplet'
      },
      {
        id: 'brake_fluid',
        slug: 'brake-fluid',
        label: 'Brake Fluid',
        iconName: 'Droplet'
      },
      {
        id: 'transmission_fluid',
        slug: 'transmission-fluid',
        label: 'Transmission Fluid',
        iconName: 'Droplet'
      },
      {
        id: 'coolant',
        slug: 'coolant',
        label: 'Coolant',
        iconName: 'Thermometer'
      }
    ]
  },
  {
    id: 'accessories',
    slug: 'accessories',
    label: 'Aksesuar ve Donanım',
    image: '/img/967_accessories_and_equipment.webp',
    children: [
      {
        id: 'interior',
        slug: 'interior',
        label: 'Interior',
        iconName: 'Briefcase'
      },
      { id: 'exterior', slug: 'exterior', label: 'Exterior', iconName: 'Car' },
      { id: 'safety', slug: 'safety', label: 'Safety', iconName: 'Activity' },
      {
        id: 'cleaning',
        slug: 'cleaning',
        label: 'Cleaning',
        iconName: 'Droplet'
      }
    ]
  },
  {
    id: 'tools',
    slug: 'tools',
    label: 'Aletler',
    image: '/img/1023_tools.webp',
    children: [
      {
        id: 'hand_tools',
        slug: 'hand-tools',
        label: 'Hand Tools',
        iconName: 'Wrench'
      },
      {
        id: 'power_tools',
        slug: 'power-tools',
        label: 'Power Tools',
        iconName: 'Zap'
      },
      {
        id: 'diagnostic',
        slug: 'diagnostic',
        label: 'Diagnostic',
        iconName: 'Activity'
      }
    ]
  },
  {
    id: 'bicycle',
    slug: 'bicycle-parts',
    label: 'Bisiklet Parçaları',
    image: '/img/bicycle_parts_1_.webp',
    children: [
      {
        id: 'bike_brakes',
        slug: 'bike-brakes',
        label: 'Brakes',
        iconName: 'Disc'
      },
      {
        id: 'bike_chains',
        slug: 'bike-chains',
        label: 'Chains',
        iconName: 'Link'
      },
      {
        id: 'bike_tires',
        slug: 'bike-tires',
        label: 'Tires',
        iconName: 'Circle'
      }
    ]
  }
]

// Helper function to get a top-level category by slug
export function getTopCategoryBySlug(slug: string): CategoryNode | undefined {
  return TOP_LEVEL_CATEGORIES.find((cat) => cat.slug === slug)
}

// Get all top-level category slugs
export function getTopCategorySlugs(): string[] {
  return TOP_LEVEL_CATEGORIES.map((cat) => cat.slug)
}

// Legacy export for backwards compatibility
export const CATEGORY_TREE = TOP_LEVEL_CATEGORIES[0]?.children || []
