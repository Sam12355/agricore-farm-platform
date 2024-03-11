// GuardianLink design tokens.
//
// Generated from packages/design-tokens/src/tokens.ts.
// Do not edit by hand: run `pnpm --filter @guardianlink/design-tokens build` instead.

import UIKit

public enum GLColor {
    /// Page background
    static let surfaceBase = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.0510, green: 0.0667, blue: 0.0902, alpha: 1)
            : UIColor(red: 1.0000, green: 1.0000, blue: 1.0000, alpha: 1)
    }

    /// Cards, panels, sheets
    static let surfaceRaised = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.0863, green: 0.1059, blue: 0.1333, alpha: 1)
            : UIColor(red: 0.9608, green: 0.9686, blue: 0.9804, alpha: 1)
    }

    /// Wells, code blocks, map chrome
    static let surfaceSunken = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.0039, green: 0.0157, blue: 0.0353, alpha: 1)
            : UIColor(red: 0.9137, green: 0.9294, blue: 0.9529, alpha: 1)
    }

    /// Modals and popovers
    static let surfaceOverlay = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.1098, green: 0.1294, blue: 0.1569, alpha: 1)
            : UIColor(red: 1.0000, green: 1.0000, blue: 1.0000, alpha: 1)
    }

    /// Body copy and headings
    static let textPrimary = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.9020, green: 0.9294, blue: 0.9529, alpha: 1)
            : UIColor(red: 0.0706, green: 0.0863, blue: 0.1098, alpha: 1)
    }

    /// Supporting copy and labels
    static let textSecondary = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.5686, green: 0.5961, blue: 0.6314, alpha: 1)
            : UIColor(red: 0.2902, green: 0.3294, blue: 0.3843, alpha: 1)
    }

    /// Text on a filled brand or danger surface
    static let textInverse = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.0510, green: 0.0667, blue: 0.0902, alpha: 1)
            : UIColor(red: 1.0000, green: 1.0000, blue: 1.0000, alpha: 1)
    }

    /// Disabled control labels
    static let textDisabled = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.4314, green: 0.4627, blue: 0.5059, alpha: 1)
            : UIColor(red: 0.4627, green: 0.4980, blue: 0.5490, alpha: 1)
    }

    /// Primary actions and links
    static let brandPrimary = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.2471, green: 0.6353, blue: 0.8392, alpha: 1)
            : UIColor(red: 0.0431, green: 0.3725, blue: 0.5412, alpha: 1)
    }

    /// Primary action hover state
    static let brandPrimaryHover = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.3882, green: 0.7137, blue: 0.8784, alpha: 1)
            : UIColor(red: 0.0314, green: 0.2902, blue: 0.4235, alpha: 1)
    }

    /// Tinted brand background
    static let brandSubtle = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.0510, green: 0.1725, blue: 0.2392, alpha: 1)
            : UIColor(red: 0.8863, green: 0.9412, blue: 0.9725, alpha: 1)
    }

    /// Safe, resolved, arrived
    static let statusSafe = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.2941, green: 0.7490, blue: 0.5412, alpha: 1)
            : UIColor(red: 0.1020, green: 0.4196, blue: 0.2902, alpha: 1)
    }

    /// Safe state background
    static let statusSafeSubtle = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.0549, green: 0.1647, blue: 0.1216, alpha: 1)
            : UIColor(red: 0.8902, green: 0.9569, blue: 0.9255, alpha: 1)
    }

    /// Session overdue, degraded, pending
    static let statusCaution = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.8784, green: 0.6667, blue: 0.2588, alpha: 1)
            : UIColor(red: 0.5412, green: 0.3529, blue: 0.0000, alpha: 1)
    }

    /// Caution state background
    static let statusCautionSubtle = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.2000, green: 0.1490, blue: 0.0392, alpha: 1)
            : UIColor(red: 0.9922, green: 0.9451, blue: 0.8627, alpha: 1)
    }

    /// Active incident. Used nowhere else
    static let statusCritical = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.9412, green: 0.3804, blue: 0.4275, alpha: 1)
            : UIColor(red: 0.6471, green: 0.1216, blue: 0.1686, alpha: 1)
    }

    /// Active incident background
    static let statusCriticalSubtle = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.2392, green: 0.0667, blue: 0.0863, alpha: 1)
            : UIColor(red: 0.9922, green: 0.9176, blue: 0.9255, alpha: 1)
    }

    /// Cancelled, archived, inactive
    static let statusNeutral = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.5686, green: 0.5961, blue: 0.6314, alpha: 1)
            : UIColor(red: 0.2902, green: 0.3294, blue: 0.3843, alpha: 1)
    }

    /// Dividers and input borders
    static let borderDefault = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.1882, green: 0.2118, blue: 0.2392, alpha: 1)
            : UIColor(red: 0.8275, green: 0.8549, blue: 0.8902, alpha: 1)
    }

    /// Emphasised borders and input outlines
    static let borderStrong = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.4314, green: 0.4627, blue: 0.5059, alpha: 1)
            : UIColor(red: 0.4196, green: 0.4627, blue: 0.5176, alpha: 1)
    }

    /// Keyboard focus indicator. Never removed, only restyled
    static let focusRing = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.3882, green: 0.7137, blue: 0.8784, alpha: 1)
            : UIColor(red: 0.0431, green: 0.3725, blue: 0.5412, alpha: 1)
    }
}

public enum GLSpacing {
    static let space0: CGFloat = 0
    static let space1: CGFloat = 4.0
    static let space2: CGFloat = 8.0
    static let space3: CGFloat = 12.0
    static let space4: CGFloat = 16.0
    static let space5: CGFloat = 24.0
    static let space6: CGFloat = 32.0
    static let space7: CGFloat = 48.0
    static let space8: CGFloat = 64.0
}

public enum GLLayout {
    /// Minimum hit area, from the WCAG 2.2 target-size guidance.
    public static let minTouchTarget: CGFloat = 44
}
